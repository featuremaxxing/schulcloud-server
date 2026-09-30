import { StorageLocation } from '@infra/files-storage-amqp-client';
import { LegacyLogger } from '@infra/logger';
import { Action, AuthorizationService } from '@modules/authorization';
import { BoardContextApiHelperService } from '@modules/board-context';
import { CopyStatus, CopyStatusEnum } from '@modules/copy-helper';
import { CourseService } from '@modules/course';
import { RoomService } from '@modules/room';
import { User } from '@modules/user/repo';
import { RoomMembershipService } from '@modules/room-membership';
import { BadRequestException, forwardRef, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { FeatureDisabledLoggableException } from '@shared/common/loggable-exception';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { Permission } from '@shared/domain/interface';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule, BoardOperation } from '../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import { CreateBoardBodyParams } from '../controller/dto';
import {
	BoardExternalReference,
	BoardExternalReferenceType,
	BoardFeature,
	BoardLayout,
	BoardNodeAuthorizable,
	BoardNodeFactory,
	BoardNodeType,
	canManageCheckboxDescendants,
	Card,
	Column,
	ColumnBoard,
	isColumn,
	PinnedCardInfo,
	PinnedCardStatus,
} from '../domain';
import {
	BoardNodeAuthorizableService,
	BoardNodeService,
	BoardProgressService,
	ColumnBoardService,
	LearningRoomService,
} from '../service';
import { StorageLocationReference } from '../service/internal';

@Injectable()
export class BoardUc {
	constructor(
		@Inject(forwardRef(() => AuthorizationService)) // TODO is this needed?
		private readonly authorizationService: AuthorizationService,
		private readonly roomMembershipService: RoomMembershipService,
		private readonly boardNodeService: BoardNodeService,
		private readonly columnBoardService: ColumnBoardService,
		private readonly logger: LegacyLogger,
		private readonly courseService: CourseService,
		private readonly roomService: RoomService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly boardContextApiHelperService: BoardContextApiHelperService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly learningRoomService: LearningRoomService,
		private readonly boardProgressService: BoardProgressService
	) {
		this.logger.setContext(BoardUc.name);
	}

	public async createBoard(userId: EntityId, params: CreateBoardBodyParams): Promise<ColumnBoard> {
		if (params.layout === BoardLayout.FILES) {
			if (!this.config.featureBoardFileAreaEnabled) {
				throw new BadRequestException('File areas are not enabled');
			}
			if (params.parentType !== BoardExternalReferenceType.Room) {
				throw new BadRequestException('File areas can only be created in rooms');
			}
		}

		await this.checkBoardCreatePermission(userId, { type: params.parentType, id: params.parentId });

		const board = this.boardNodeFactory.buildColumnBoard({
			context: { type: params.parentType, id: params.parentId },
			title: params.title,
			layout: params.layout,
		});

		await this.boardNodeService.addRoot(board);

		return board;
	}

	public async findBoard(
		userId: EntityId,
		boardId: EntityId
	): Promise<{
		board: ColumnBoard;
		features: BoardFeature[];
		allowedOperations: Record<BoardOperation, boolean>;
		pinnedCardOrigins: Map<EntityId, PinnedCardInfo>;
	}> {
		// TODO set depth=2 to reduce data?
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, boardNodeAuthorizable));

		const features = await this.boardContextApiHelperService.getFeaturesForBoardNode(boardId);
		let allowedOperations = this.boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);
		let pinnedCardOrigins = new Map<EntityId, PinnedCardInfo>();

		// Every way of loading a board ends up here - the rest endpoint as well as the
		// collaboration socket, which is what the client actually uses. Personal board
		// handling therefore belongs here, not in the learning room endpoint.
		if (board.context.type === BoardExternalReferenceType.User) {
			pinnedCardOrigins = await this.resolvePinnedCards(board, user, userId);
			allowedOperations = this.hidePersonalBoardOperations(allowedOperations);
		}

		return { board, features, allowedOperations, pinnedCardOrigins };
	}

	/**
	 * The owner is editor and admin of their own board, so the rule grants every
	 * board level action. In a personal room they are pointless (share, copy,
	 * publish, rename - the name lives in the navigation) or destructive: deleting
	 * the board would take all pinned cards with it.
	 */
	private hidePersonalBoardOperations(
		allowedOperations: Record<BoardOperation, boolean>
	): Record<BoardOperation, boolean> {
		return {
			...allowedOperations,
			copyBoard: false,
			deleteBoard: false,
			shareBoard: false,
			updateBoardTitle: false,
			updateReadersCanEditSetting: false,
			updateBoardVisibility: false,
			// Assignment and poll elements pick the teacher view by isBoardEditor of the
			// board they are shown in. Here that is the owner's own room, so a student
			// would get the submission overview instead of the submit form of a pinned
			// assignment. Nobody teaches anyone in their own learning room.
			isBoardEditor: false,
		};
	}

	/**
	 * Maps every pinned card the user can currently read to where it lives - the
	 * mapper renders exactly these, so this is also the read check for pointers.
	 *
	 * Pointers whose card no longer exists are deleted. Pointers the user merely
	 * cannot read right now are kept: a teacher hiding or locking a board must not
	 * wipe the pins of the whole class, and they come back once it is visible.
	 */
	private async resolvePinnedCards(
		board: ColumnBoard,
		user: User,
		userId: EntityId
	): Promise<Map<EntityId, PinnedCardInfo>> {
		const pinnedCards = this.learningRoomService.findPinnedCards(board);
		if (pinnedCards.length === 0) {
			return new Map();
		}

		const cards = await this.boardNodeService.findByClassAndIds(
			Card,
			pinnedCards.map((node) => node.referencedCardId)
		);

		const existingCardIds = new Set(cards.map((card) => card.id));
		const deletedCardPointers = pinnedCards.filter((node) => !existingCardIds.has(node.referencedCardId));
		for (const node of deletedCardPointers) {
			await this.boardNodeService.delete(node);
		}

		const authorizables = await this.boardNodeAuthorizableService.getBoardAuthorizables(cards);
		const readableAuthorizables = authorizables.filter((authorizable) =>
			this.boardNodeRule.can('findCards', user, authorizable)
		);
		const rootIdByCardId = new Map(
			readableAuthorizables.map((authorizable) => [authorizable.boardNode.id, authorizable.boardNode.rootId])
		);
		const statusByCardId = await this.resolvePinnedCardStatus(readableAuthorizables, userId);

		// resolved once per source board, not per card - a learning room usually
		// holds several cards from the same room
		const titleByRootId = new Map<EntityId, string>();
		for (const rootId of new Set(rootIdByCardId.values())) {
			try {
				const parents = await this.boardContextApiHelperService.getParentsOfElement(rootId);
				const title = parents[0]?.name;
				if (title) {
					titleByRootId.set(rootId, title);
				}
			} catch {
				// a source board we cannot resolve simply gets a chip without a name
			}
		}

		const originByPinnedCardId = new Map<EntityId, PinnedCardInfo>();
		pinnedCards.forEach((node) => {
			const rootId = rootIdByCardId.get(node.referencedCardId);
			if (rootId) {
				originByPinnedCardId.set(node.id, {
					boardId: rootId,
					title: titleByRootId.get(rootId),
					status: statusByCardId.get(node.referencedCardId),
				});
			}
		});

		return originByPinnedCardId;
	}

	/**
	 * The owner's own progress per pinned card, computed with the same rules as the
	 * progress bars of boards and rooms - one pass per source board. Cards without
	 * anything to do (no checkbox, assignment or poll for this user) get no status.
	 */
	private async resolvePinnedCardStatus(
		readableAuthorizables: BoardNodeAuthorizable[],
		userId: EntityId
	): Promise<Map<EntityId, PinnedCardStatus>> {
		const statusByCardId = new Map<EntityId, PinnedCardStatus>();

		const sourceBoards = new Map<EntityId, BoardNodeAuthorizable>();
		readableAuthorizables.forEach((authorizable) => {
			if (authorizable.rootNode instanceof ColumnBoard) {
				sourceBoards.set(authorizable.rootNode.id, authorizable);
			}
		});
		const enabledTypes = this.progressElementTypes();
		if (sourceBoards.size === 0 || enabledTypes.length === 0) {
			return statusByCardId;
		}

		try {
			const results = await this.boardProgressService.computeBoardsProgress(
				userId,
				Array.from(sourceBoards.values()).map((auth) => {
					return {
						board: auth.rootNode as ColumnBoard,
						auth,
						// own progress only - also keeps assignments that have not started hidden
						isTeacherView: false,
					};
				}),
				enabledTypes
			);

			results
				.flatMap((result) => result.items)
				.filter((item) => item.eligible)
				.forEach((item) => {
					const status = statusByCardId.get(item.cardId) ?? { done: 0, total: 0 };
					status.total += 1;
					if (item.done) {
						status.done += 1;
					} else if (item.dueDate && (!status.nextDueDate || item.dueDate < status.nextDueDate)) {
						status.nextDueDate = item.dueDate;
					}
					statusByCardId.set(item.cardId, status);
				});
		} catch (error) {
			// the status is a hint - the learning room must load without it
			this.logger.warn(`Could not compute pinned card status: ${String(error)}`);
		}

		return statusByCardId;
	}

	private progressElementTypes(): BoardNodeType[] {
		const types: BoardNodeType[] = [];
		if (this.config.featureColumnBoardCheckboxEnabled) types.push(BoardNodeType.CHECKBOX_ELEMENT);
		if (this.config.featureColumnBoardAssignmentEnabled) types.push(BoardNodeType.ASSIGNMENT_ELEMENT);
		if (this.config.featureColumnBoardPollEnabled) types.push(BoardNodeType.POLL_ELEMENT);
		return types;
	}

	public async findBoardContext(userId: EntityId, boardId: EntityId): Promise<BoardExternalReference> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, boardNodeAuthorizable));

		return board.context;
	}

	public async deleteBoard(userId: EntityId, boardId: EntityId): Promise<ColumnBoard> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId, 3); // TODO decide to refactor returned object vs return boardNodeId
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.boardNodeRule.can('deleteBoard', user, boardNodeAuthorizable));
		throwForbiddenIfFalse(canManageCheckboxDescendants(board, userId));

		await this.boardNodeService.delete(board);
		return board;
	}

	public async updateBoardTitle(userId: EntityId, boardId: EntityId, title: string): Promise<ColumnBoard> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId); // TODO decide to refactor returned object vs return boardNodeId
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateBoardTitle', user, boardNodeAuthorizable));

		await this.boardNodeService.updateTitle(board, title);
		return board;
	}

	public async createColumn(userId: EntityId, boardId: EntityId): Promise<Column> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.boardNodeRule.can('createColumn', user, boardNodeAuthorizable));

		const column = this.boardNodeFactory.buildColumn();

		await this.boardNodeService.addToParent(board, column);

		return column;
	}

	public async moveColumn(
		userId: EntityId,
		columnId: EntityId,
		targetBoardId: EntityId,
		targetPosition: number
	): Promise<Column> {
		const user = await this.authorizationService.getUserWithPermissions(userId);

		const column = await this.boardNodeService.findByClassAndId(Column, columnId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(column);

		throwForbiddenIfFalse(this.boardNodeRule.can('moveColumn', user, boardNodeAuthorizable));

		const targetBoard = await this.boardNodeService.findByClassAndId(ColumnBoard, targetBoardId);
		const boardNodeAuthorizableTargetBoard = await this.boardNodeAuthorizableService.getBoardAuthorizable(targetBoard);

		throwForbiddenIfFalse(this.boardNodeRule.can('moveColumn', user, boardNodeAuthorizableTargetBoard));

		await this.boardNodeService.move(column, targetBoard, targetPosition);
		return column;
	}

	public async copyColumn(
		userId: EntityId,
		columnId: EntityId,
		schoolId: EntityId
	): Promise<{ copyEntity: Column; status: CopyStatusEnum }> {
		const column = await this.boardNodeService.findByClassAndId(Column, columnId);

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(column);

		throwForbiddenIfFalse(this.boardNodeRule.can('copyColumn', user, boardNodeAuthorizable));

		const copyStatus = await this.columnBoardService.copyColumn({
			originalColumnId: column.id,
			userId,
			targetStorageLocationReference: { id: schoolId, type: StorageLocation.SCHOOL },
			sourceStorageLocationReference: { id: schoolId, type: StorageLocation.SCHOOL },
			targetSchoolId: schoolId,
		});

		if (!isColumn(copyStatus.copyEntity)) {
			throw new InternalServerErrorException('Copied entity is not a column');
		}

		await this.columnBoardService.updateIdsInLinks(copyStatus);

		return { copyEntity: copyStatus.copyEntity, status: copyStatus.status };
	}

	public async copyBoard(userId: EntityId, boardId: EntityId, targetSchoolId: EntityId): Promise<CopyStatus> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);

		throwForbiddenIfFalse(this.boardNodeRule.can('copyBoard', user, boardNodeAuthorizable));

		const sourceStorageLocationReference = await this.getStorageLocationReference(board.context);
		const targetStorageLocationReference = { id: targetSchoolId, type: StorageLocation.SCHOOL };

		const copyStatus = await this.columnBoardService.copyColumnBoard({
			originalColumnBoardId: boardId,
			targetExternalReference: board.context,
			sourceStorageLocationReference,
			targetStorageLocationReference,
			userId,
			targetSchoolId,
		});

		await this.columnBoardService.updateIdsInLinks(copyStatus);

		return copyStatus;
	}

	public async updateVisibility(userId: EntityId, boardId: EntityId, isVisible: boolean): Promise<ColumnBoard> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateBoardVisibility', user, boardNodeAuthorizable));

		await this.boardNodeService.updateVisibility(board, isVisible);

		return board;
	}

	public async updateReadersCanEdit(
		userId: EntityId,
		boardId: EntityId,
		readersCanEdit: boolean
	): Promise<ColumnBoard> {
		if (!this.config.featureBoardReadersCanEditToggle) {
			throw new FeatureDisabledLoggableException('FEATURE_BOARD_READERS_CAN_EDIT_TOGGLE');
		}

		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateReadersCanEditSetting', user, boardNodeAuthorizable));

		await this.columnBoardService.updateReadersCanEdit(board, readersCanEdit);
		return board;
	}

	public async updateLayout(userId: EntityId, boardId: EntityId, layout: BoardLayout): Promise<ColumnBoard> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateBoardLayout', user, boardNodeAuthorizable));

		if (layout === BoardLayout.FILES || board.layout === BoardLayout.FILES) {
			throw new BadRequestException('The layout of a file area cannot be changed');
		}

		await this.boardNodeService.updateLayout(board, layout);
		return board;
	}

	private async checkBoardCreatePermission(userId: EntityId, context: BoardExternalReference): Promise<void> {
		const user = await this.authorizationService.getUserWithPermissions(userId);

		if (context.type === BoardExternalReferenceType.Course) {
			const course = await this.courseService.findById(context.id);

			this.authorizationService.checkPermission(user, course, {
				action: Action.write,
				requiredPermissions: [Permission.COURSE_EDIT],
			});
		} else if (context.type === BoardExternalReferenceType.Room) {
			const roomAuthorizable = await this.roomMembershipService.getRoomAuthorizable(context.id);

			this.authorizationService.checkPermission(user, roomAuthorizable, {
				action: Action.write,
				requiredPermissions: [Permission.ROOM_EDIT_CONTENT],
			});
		} else {
			throw new Error(`Unsupported context type ${context.type as string}`);
		}
	}

	private async getStorageLocationReference(context: BoardExternalReference): Promise<StorageLocationReference> {
		if (context.type === BoardExternalReferenceType.Course) {
			const course = await this.courseService.findById(context.id);

			return { id: course.school.id, type: StorageLocation.SCHOOL };
		}

		if (context.type === BoardExternalReferenceType.Room) {
			const room = await this.roomService.getSingleRoom(context.id);

			return { id: room.schoolId, type: StorageLocation.SCHOOL };
		}
		/* istanbul ignore next */
		throw new Error(`Unsupported board reference type ${context.type as string}`);
	}
}
