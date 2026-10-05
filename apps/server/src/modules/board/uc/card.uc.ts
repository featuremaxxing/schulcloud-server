import { LegacyLogger } from '@infra/logger';
import { AuthorizationService } from '@modules/authorization';
import { BadRequestException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';

import { throwForbiddenIfFalse } from '@shared/common/utils';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import {
	AnyBoardNode,
	AnyContentElement,
	BoardExternalReferenceType,
	canManageCheckboxDescendants,
	BoardNodeFactory,
	Card,
	Colors,
	ContentElementType,
	isAiQuestionElement,
	isAssignmentElement,
	isCheckboxElement,
	isColumnBoard,
	isPollElement,
	isTeacherMember,
	type UserWithBoardRoles,
} from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService, LearningPathStateService } from '../service';

// the elements that count in the progress of a board
const PROGRESS_ELEMENT_TYPES = [ContentElementType.CHECKBOX, ContentElementType.ASSIGNMENT, ContentElementType.POLL];

@Injectable()
export class CardUc {
	constructor(
		@Inject(forwardRef(() => AuthorizationService))
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly logger: LegacyLogger,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly learningPathStateService: LearningPathStateService,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig
	) {
		this.logger.setContext(CardUc.name);
	}

	public async findCards(userId: EntityId, cardIds: EntityId[]): Promise<Card[]> {
		const cards = await this.boardNodeService.findByClassAndIds(Card, cardIds);
		if (cards.length === 0) {
			return [];
		}

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardAuthorizables = await this.boardNodeAuthorizableService.getBoardAuthorizables(cards);

		const allowedCards = boardAuthorizables.reduce((allowedNodes: AnyBoardNode[], boardNodeAuthorizable) => {
			if (this.boardNodeRule.can('findCards', user, boardNodeAuthorizable)) {
				allowedNodes.push(boardNodeAuthorizable.boardNode);
			}
			return allowedNodes;
		}, []) as Card[];

		return allowedCards;
	}

	public async updateCardHeight(userId: EntityId, cardId: EntityId, height: number): Promise<Card> {
		const card = await this.boardNodeService.findByClassAndId(Card, cardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateCardHeight', user, boardNodeAuthorizable));

		await this.boardNodeService.updateHeight(card, height);
		return card;
	}

	public async updateCardTitle(userId: EntityId, cardId: EntityId, title: string): Promise<Card> {
		const card = await this.boardNodeService.findByClassAndId(Card, cardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateCardTitle', user, boardNodeAuthorizable));

		await this.boardNodeService.updateTitle(card, title);
		return card;
	}

	public async updateCardColor(userId: EntityId, cardId: EntityId, color: Colors): Promise<Card> {
		const card = await this.boardNodeService.findByClassAndId(Card, cardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateCardColor', user, boardNodeAuthorizable));

		await this.boardNodeService.updateBackgroundColor(card, color);
		return card;
	}

	public async deleteCard(userId: EntityId, cardId: EntityId): Promise<EntityId> {
		const card = await this.boardNodeService.findByClassAndId(Card, cardId, 1);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);

		throwForbiddenIfFalse(this.boardNodeRule.can('deleteCard', user, boardNodeAuthorizable));
		throwForbiddenIfFalse(canManageCheckboxDescendants(card, userId));

		const { rootId } = card; // needs to be captured before deletion
		await this.boardNodeService.delete(card);

		return rootId;
	}

	// --- elements ---

	public async createElement(
		userId: EntityId,
		cardId: EntityId,
		type: ContentElementType,
		toPosition?: number
	): Promise<AnyContentElement> {
		const card = await this.boardNodeService.findByClassAndId(Card, cardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(card);
		const isVideoConferenceElement = type === ContentElementType.VIDEO_CONFERENCE;

		throwForbiddenIfFalse(this.boardNodeRule.can('createElement', user, boardNodeAuthorizable));
		if (type === ContentElementType.CHECKBOX) {
			throwForbiddenIfFalse(
				this.boardNodeRule.can('isBoardEditor', user, boardNodeAuthorizable) &&
					boardNodeAuthorizable.users.some((member) => member.userId === userId && isTeacherMember(member))
			);
		}

		if (type === ContentElementType.FILE_AREA_LINK) {
			await this.checkFileAreaLinkAllowed(card);
		}

		if (type === ContentElementType.AI_QUESTION) {
			throwForbiddenIfFalse(this.boardNodeRule.can('manageAiQuestion', user, boardNodeAuthorizable));
		}

		if (isVideoConferenceElement) {
			throwForbiddenIfFalse(this.boardNodeRule.can('manageVideoConference', user, boardNodeAuthorizable));
		}

		if (PROGRESS_ELEMENT_TYPES.includes(type)) {
			await this.rememberCompletions(card, boardNodeAuthorizable.users);
		}

		const element = this.boardNodeFactory.buildContentElement(type, userId);

		await this.boardNodeService.addToParent(card, element, toPosition);

		return element;
	}

	// links to file areas only make sense in rooms: file areas live in rooms, and the link must
	// point into the same room
	private async checkFileAreaLinkAllowed(card: Card): Promise<void> {
		if (!this.config.featureBoardFileAreaEnabled) {
			throw new BadRequestException('File areas are not enabled');
		}
		const board = await this.boardNodeService.findRoot(card, 0);
		if (!isColumnBoard(board) || board.context.type !== BoardExternalReferenceType.Room) {
			throw new BadRequestException('File area links can only be added to boards in rooms');
		}
	}

	public async moveElement(
		userId: EntityId,
		elementId: EntityId,
		targetCardId: EntityId,
		targetPosition: number
	): Promise<AnyContentElement> {
		const element = await this.boardNodeService.findContentElementById(elementId);
		const targetCard = await this.boardNodeService.findByClassAndId(Card, targetCardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(targetCard);

		throwForbiddenIfFalse(this.boardNodeRule.can('moveElement', user, boardNodeAuthorizable));
		if (isAiQuestionElement(element) || isCheckboxElement(element)) {
			const elementAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);
			throwForbiddenIfFalse(this.boardNodeRule.can('updateElement', user, elementAuthorizable));
		}

		if (
			(isCheckboxElement(element) || isAssignmentElement(element) || isPollElement(element)) &&
			element.rootId !== targetCard.rootId
		) {
			await this.rememberCompletions(targetCard, boardNodeAuthorizable.users);
		}

		await this.boardNodeService.move(element, targetCard, targetPosition);

		return element;
	}

	// A board with learning path steps keeps what its completions unlocked when a progress item is
	// added: the people who are done now are remembered before the new item makes them not done.
	private async rememberCompletions(card: Card, users: UserWithBoardRoles[]): Promise<void> {
		const board = await this.boardNodeService.findRoot(card, 0);
		if (isColumnBoard(board)) {
			await this.learningPathStateService.rememberCompletions(board, users);
		}
	}
}
