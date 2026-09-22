import { AuthorizationService } from '@modules/authorization';

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { FeatureDisabledLoggableException } from '@shared/common/loggable-exception';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import type { EntityId } from '@shared/domain/types';
import { BoardNodeRule, BoardOperation } from '../../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../../board.config';
import {
	BoardExternalReferenceType,
	BoardFeature,
	BoardNodeFactory,
	Card,
	Column,
	ColumnBoard,
	PinnedCard,
	PinnedCardOrigin,
} from '../../domain';
import { BoardNodeAuthorizableService, BoardNodeService, LearningRoomService } from '../../service';
import { BoardUc } from '../board.uc';

@Injectable()
export class LearningRoomUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly learningRoomService: LearningRoomService,
		private readonly boardUc: BoardUc,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig
	) {}

	public async getLearningRoom(userId: EntityId): Promise<{
		board: ColumnBoard;
		features: BoardFeature[];
		allowedOperations: Record<BoardOperation, boolean>;
		pinnedCardOrigins: Map<EntityId, PinnedCardOrigin>;
	}> {
		this.checkFeatureEnabled();

		const board = await this.learningRoomService.getOrCreatePersonalLearningRoomOfUser(userId);

		// findBoard is the path every client actually uses (the collaboration socket
		// goes through it too), and it carries the personal board handling - origin
		// chips, dead pointer cleanup, trimmed board actions. Going through it here
		// keeps both routes identical.
		const result = await this.boardUc.findBoard(userId, board.id);

		return result;
	}

	public async pinCard(userId: EntityId, cardId: EntityId): Promise<PinnedCard> {
		this.checkFeatureEnabled();

		const card = await this.boardNodeService.findByClassAndId(Card, cardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		// the user must be allowed to see the card in its original board - pinning
		// must never widen access
		const cardAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);
		throwForbiddenIfFalse(this.boardNodeRule.can('findCards', user, cardAuthorizable));

		// own cards of the learning room already live there - pinning one would show
		// it twice in the same board
		const sourceBoard = cardAuthorizable.rootNode;
		if (sourceBoard instanceof ColumnBoard && sourceBoard.context.type === BoardExternalReferenceType.User) {
			throw new BadRequestException('Cards of a personal board cannot be pinned');
		}

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
