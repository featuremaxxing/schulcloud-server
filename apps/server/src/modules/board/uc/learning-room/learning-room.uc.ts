import { AuthorizationService } from '@modules/authorization';
import { BoardContextApiHelperService } from '@modules/board-context';

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { FeatureDisabledLoggableException } from '@shared/common/loggable-exception';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import type { EntityId } from '@shared/domain/types';
import { BoardNodeRule, BoardOperation } from '../../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../../board.config';
import { BoardFeature, BoardNodeFactory, Card, Column, ColumnBoard, PinnedCard } from '../../domain';
import { BoardNodeAuthorizableService, BoardNodeService, LearningRoomService } from '../../service';

@Injectable()
export class LearningRoomUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly learningRoomService: LearningRoomService,
		private readonly boardContextApiHelperService: BoardContextApiHelperService,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig
	) {}

	public async getLearningRoom(userId: EntityId): Promise<{
		board: ColumnBoard;
		features: BoardFeature[];
		allowedOperations: Record<BoardOperation, boolean>;
		pinnedCardOrigins: Map<EntityId, string>;
	}> {
		this.checkFeatureEnabled();

		const board = await this.learningRoomService.getOrCreatePersonalLearningRoomOfUser(userId);

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const allowedOperations = this.boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);

		// a personal board has no course/room context, so no context driven features
		const features: BoardFeature[] = [];

		await this.removeUnreachablePinnedCards(board, userId);
		const pinnedCardOrigins = await this.resolvePinnedCardOrigins(board);

		return { board, features, allowedOperations, pinnedCardOrigins };
	}

	/**
	 * Drops pointers whose card the user can no longer reach - deleted card, board
	 * gone, or simply removed from the course. Without this they would sit in the
	 * learning room forever as entries that never load.
	 */
	private async removeUnreachablePinnedCards(board: ColumnBoard, userId: EntityId): Promise<void> {
		const pinnedCards = this.learningRoomService.findPinnedCards(board);
		if (pinnedCards.length === 0) {
			return;
		}

		const referencedIds = pinnedCards.map((node) => node.referencedCardId);
		const cards = await this.boardNodeService.findByClassAndIds(Card, referencedIds);

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const authorizables = await this.boardNodeAuthorizableService.getBoardAuthorizables(cards);
		const readableCardIds = new Set(
			authorizables
				.filter((authorizable) => this.boardNodeRule.can('findCards', user, authorizable))
				.map((authorizable) => authorizable.boardNode.id)
		);

		const unreachable = pinnedCards.filter((node) => !readableCardIds.has(node.referencedCardId));
		for (const node of unreachable) {
			await this.boardNodeService.delete(node);
		}
	}

	/**
	 * Maps each remaining pointer to the name of the room or course its card lives
	 * in, for the origin chip on the card. Resolved once per source board, not per
	 * card - a learning room usually holds several cards from the same room.
	 */
	private async resolvePinnedCardOrigins(board: ColumnBoard): Promise<Map<EntityId, string>> {
		const pinnedCards = this.learningRoomService.findPinnedCards(board);
		if (pinnedCards.length === 0) {
			return new Map();
		}

		const cards = await this.boardNodeService.findByClassAndIds(
			Card,
			pinnedCards.map((node) => node.referencedCardId)
		);
		const rootIdByCardId = new Map(cards.map((card) => [card.id, card.rootId]));

		const originByRootId = new Map<EntityId, string>();
		for (const rootId of new Set(rootIdByCardId.values())) {
			try {
				const parents = await this.boardContextApiHelperService.getParentsOfElement(rootId);
				const origin = parents[0]?.name;
				if (origin) {
					originByRootId.set(rootId, origin);
				}
			} catch {
				// a source board we cannot resolve simply gets no chip
			}
		}

		const originByPinnedCardId = new Map<EntityId, string>();
		pinnedCards.forEach((node) => {
			const rootId = rootIdByCardId.get(node.referencedCardId);
			const origin = rootId ? originByRootId.get(rootId) : undefined;
			if (origin) {
				originByPinnedCardId.set(node.id, origin);
			}
		});

		return originByPinnedCardId;
	}

	/**
	 * Pins a card from a regular board into the user's learning room. The card is
	 * not copied or moved - only a pointer node is created, so the card keeps
	 * living in its own board and stays authorized through that board's context.
	 */
	public async pinCard(userId: EntityId, cardId: EntityId): Promise<PinnedCard> {
		this.checkFeatureEnabled();

		const card = await this.boardNodeService.findByClassAndId(Card, cardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		// the user must be allowed to see the card in its original board - pinning
		// must never widen access
		const cardAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);
		throwForbiddenIfFalse(this.boardNodeRule.can('findCards', user, cardAuthorizable));

		const board = await this.learningRoomService.getOrCreatePersonalLearningRoomOfUser(userId);

		const alreadyPinned = this.learningRoomService.findPinnedCardByReference(board, cardId);
		if (alreadyPinned) {
			return alreadyPinned;
		}

		const targetColumn = this.getFirstColumn(board);
		const pinnedCard = this.boardNodeFactory.buildPinnedCard(cardId);
		await this.boardNodeService.addToParent(targetColumn, pinnedCard);

		return pinnedCard;
	}

	public async unpinCard(userId: EntityId, cardId: EntityId): Promise<void> {
		this.checkFeatureEnabled();

		const board = await this.learningRoomService.getOrCreatePersonalLearningRoomOfUser(userId);
		const pinnedCard = this.learningRoomService.findPinnedCardByReference(board, cardId);

		if (!pinnedCard) {
			return;
		}

		await this.boardNodeService.delete(pinnedCard);
	}

	public async movePinnedCard(
		userId: EntityId,
		pinnedCardId: EntityId,
		toColumnId: EntityId,
		toPosition?: number
	): Promise<void> {
		this.checkFeatureEnabled();

		const board = await this.learningRoomService.getOrCreatePersonalLearningRoomOfUser(userId);

		// both the pointer and the target column must belong to this user's own
		// learning room - a pinned card must never be able to leave it
		const pinnedCard = this.learningRoomService.findPinnedCards(board).find((node) => node.id === pinnedCardId);
		if (!pinnedCard) {
			throw new BadRequestException('Pinned card does not belong to this learning room');
		}

		const targetColumn = board.getChildrenOfType(Column).find((column) => column.id === toColumnId);
		if (!targetColumn) {
			throw new BadRequestException('Target column does not belong to this learning room');
		}

		await this.boardNodeService.move(pinnedCard, targetColumn, toPosition);
	}

	/**
	 * Ids of the cards the user has pinned, so regular boards can render the pin
	 * button in its active state.
	 */
	public async getPinnedCardIds(userId: EntityId): Promise<EntityId[]> {
		this.checkFeatureEnabled();

		const board = await this.learningRoomService.getOrCreatePersonalLearningRoomOfUser(userId);
		const cardIds = this.learningRoomService.findPinnedCards(board).map((node) => node.referencedCardId);

		return cardIds;
	}

	private getFirstColumn(board: ColumnBoard): Column {
		const columns = board.getChildrenOfType(Column);

		/* istanbul ignore next */
		if (columns.length === 0) {
			throw new BadRequestException('Learning room has no column to pin into');
		}

		return columns[0];
	}

	private checkFeatureEnabled(): void {
		if (!this.config.featurePersonalLearningRoomEnabled) {
			throw new FeatureDisabledLoggableException('FEATURE_PERSONAL_LEARNING_ROOM_ENABLED');
		}
	}
}
