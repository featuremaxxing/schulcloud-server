import { AuthorizationService } from '@modules/authorization';
import { type User } from '@modules/user/repo';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import {
	BoardExternalReferenceType,
	BoardNodeAuthorizable,
	BoardNodeFactory,
	Card,
	ColumnBoard,
	isColumnBoard,
	LEARNING_PATH_MAX_STEPS,
	type LearningPathColor,
	LearningPathStep,
	type LearningPathUnlockMode,
	type UserWithBoardRoles,
	wouldCreateBoardCycle,
	wouldCreateCycle,
} from '../domain';
import { BoardCompletionRepo, LearningPathEnrollmentRepo } from '../repo';
import {
	BoardNodeAuthorizableService,
	BoardNodeService,
	BoardProgressService,
	ColumnBoardService,
	type LearningPathCardStep,
	type LearningPathLock,
	LearningPathNotifier,
	type LearningPathOverview,
	LearningPathStateService,
	type LearningPathStepStatus,
} from '../service';

export interface LearningPathStepView {
	step: LearningPathStep;
	// empty when a student may not see the board yet (draft) or the board is gone
	title: string;
	// card steps: the board the card lies on
	boardTitle?: string;
	isVisible: boolean;
	status: LearningPathStepStatus;
	// students: completed before, but something new came up
	reopened?: boolean;
	// students: what keeps the board closed
	lock?: LearningPathLock;
	// only for editors: how many of the students who go this learning path completed the board
	doneCount?: number;
	studentCount?: number;
}

export interface LearningPathView {
	board: ColumnBoard;
	color?: LearningPathColor;
	isEditor: boolean;
	// students: whether they go this learning path, and whether there is a choice at all
	isEnrolled?: boolean;
	canChoose?: boolean;
	// editors: the students who go this learning path and how many of them completed all of it
	studentCount?: number;
	completedStudentCount?: number;
	steps: LearningPathStepView[];
	// only for editors: the boards of the room that can be added
	availableBoards: ColumnBoard[];
}

export interface LearningPathStepUpdate {
	positionX?: number;
	positionY?: number;
	prerequisiteStepIds?: EntityId[];
	unlockMode?: LearningPathUnlockMode;
	lockUntilPrerequisitesDone?: boolean;
}

export interface BoardCompletionView {
	inLearningPath: boolean;
	canMarkManually: boolean;
	completed: boolean;
}

const NO_COMPLETION: BoardCompletionView = { inLearningPath: false, canMarkManually: false, completed: false };

@Injectable()
export class LearningPathUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly boardCompletionRepo: BoardCompletionRepo,
		private readonly learningPathEnrollmentRepo: LearningPathEnrollmentRepo,
		private readonly boardProgressService: BoardProgressService,
		private readonly columnBoardService: ColumnBoardService,
		private readonly learningPathStateService: LearningPathStateService,
		private readonly learningPathNotifier: LearningPathNotifier,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig
	) {}

	public async getLearningPath(userId: EntityId, boardId: EntityId): Promise<LearningPathView> {
		this.checkFeatureEnabled();

		const board = await this.findLearningPath(boardId);
		const { user, auth } = await this.authorize(userId, board);
		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, auth));

		const isEditor = this.boardNodeRule.can('isBoardEditor', user, auth);
		const users = isEditor ? auth.users : [this.findMember(auth, userId)];

		const summaries = await this.learningPathStateService.summarize([{ board, users, isEditor }], userId);
		const summary = summaries.get(board.id);
		const steps = (summary?.steps ?? []).map((entry): LearningPathStepView => entry);

		if (isEditor) {
			return {
				board,
				color: summary?.color,
				isEditor,
				studentCount: summary?.studentCount,
				completedStudentCount: summary?.completedStudentCount,
				steps,
				availableBoards: await this.findAvailableBoards(board),
			};
		}

		await this.keepCompletions(
			userId,
			steps.filter((entry) => entry.status === 'done').map((entry) => entry.step)
		);

		return {
			board,
			color: summary?.color,
			isEditor,
			isEnrolled: summary?.isEnrolled,
			canChoose: summary?.canChoose,
			steps,
			availableBoards: [],
		};
	}

	// A step links a board of the room, or - with linkedCardId - one card of such a board.
	public async createStep(
		userId: EntityId,
		boardId: EntityId,
		linkedBoardId: EntityId,
		positionX: number,
		positionY: number,
		linkedCardId?: EntityId
	): Promise<LearningPathStep> {
		this.checkFeatureEnabled();

		const board = await this.findLearningPath(boardId);
		await this.checkEditor(userId, board);

		if (linkedCardId) {
			const card = await this.boardNodeService.findByClassAndId(Card, linkedCardId, 0);
			linkedBoardId = card.rootId;
		}

		const steps = this.learningPathStateService.getSteps(board);
		if (steps.length >= LEARNING_PATH_MAX_STEPS) {
			throw new BadRequestException(`A learning path holds at most ${LEARNING_PATH_MAX_STEPS} boards`);
		}
		const targetId = linkedCardId ?? linkedBoardId;
		if (steps.some((step) => step.targetId === targetId)) {
			throw new BadRequestException(`The ${linkedCardId ? 'card' : 'board'} is already part of this learning path`);
		}

		const linkedBoard = await this.boardNodeService.findById(linkedBoardId, 0);
		if (!isColumnBoard(linkedBoard) || !linkedBoard.hasColumns() || !this.isSameRoom(board, linkedBoard)) {
			throw new BadRequestException('Only regular boards of the same room can be added to a learning path');
		}

		const step = this.boardNodeFactory.buildLearningPathStep(linkedBoardId, positionX, positionY, linkedCardId);
		await this.boardNodeService.addToParent(board, step);
		this.learningPathNotifier.changed(board.id);

		return step;
	}

	public async updateStep(
		userId: EntityId,
		stepId: EntityId,
		update: LearningPathStepUpdate
	): Promise<LearningPathStep> {
		this.checkFeatureEnabled();

		const { step, board } = await this.findStep(stepId);
		await this.checkEditor(userId, board);

		if (update.prerequisiteStepIds) {
			const siblings = this.learningPathStateService.getSteps(board);
			const siblingIds = new Set(siblings.map((sibling) => sibling.id));
			if (update.prerequisiteStepIds.some((id) => !siblingIds.has(id) || id === step.id)) {
				throw new BadRequestException('Arrows can only connect boards of the same learning path');
			}
			if (wouldCreateCycle(siblings, step.id, update.prerequisiteStepIds)) {
				throw new BadRequestException('The arrows would form a circle');
			}
			await this.checkNoCircleInRoom(board, step, update.prerequisiteStepIds);
			step.prerequisiteStepIds = update.prerequisiteStepIds;
		}
		if (update.positionX !== undefined) step.positionX = update.positionX;
		if (update.positionY !== undefined) step.positionY = update.positionY;
		if (update.unlockMode !== undefined) step.unlockMode = update.unlockMode;
		if (update.lockUntilPrerequisitesDone !== undefined) {
			step.lockUntilPrerequisitesDone = update.lockUntilPrerequisitesDone;
		}

		await this.boardNodeService.save(step);
		this.learningPathNotifier.changed(board.id);

		return step;
	}

	public async updateColor(userId: EntityId, boardId: EntityId, color: LearningPathColor): Promise<ColumnBoard> {
		this.checkFeatureEnabled();

		const board = await this.findLearningPath(boardId);
		await this.checkEditor(userId, board);

		board.learningPathColor = color;
		await this.boardNodeService.save(board);
		this.learningPathNotifier.changed(board.id);

		return board;
	}

	// A person goes a learning path: only the paths they go lock boards for them. Students choose
	// for themselves, editors can also set it for the members of the room.
	public async enroll(userId: EntityId, boardId: EntityId, targetUserId?: EntityId): Promise<void> {
		const { board, subject } = await this.authorizeEnrollment(userId, boardId, targetUserId);

		await this.learningPathEnrollmentRepo.enroll(subject, board.id, board.context.id);
		this.learningPathNotifier.changed(board.id);
	}

	public async unenroll(userId: EntityId, boardId: EntityId, targetUserId?: EntityId): Promise<void> {
		const { board, subject } = await this.authorizeEnrollment(userId, boardId, targetUserId);

		await this.learningPathEnrollmentRepo.unenroll(subject, board.id);
		this.learningPathNotifier.changed(board.id);
	}

	// Who goes which learning path of the room, with their progress. Editors only.
	public async getOverview(userId: EntityId, roomId: EntityId): Promise<LearningPathOverview> {
		this.checkFeatureEnabled();

		const paths = await this.learningPathStateService.findRoomPaths(roomId);
		if (paths.length === 0) {
			throw new NotFoundException('The room has no learning paths');
		}

		const { user, auth } = await this.authorize(userId, paths[0]);
		throwForbiddenIfFalse(this.boardNodeRule.can('isBoardEditor', user, auth));

		return await this.learningPathStateService.overview(roomId, auth.users);
	}

	// Starts over for the given students of the room (default: all of them): the stored completions,
	// the hand-made "done" marks and the ticks of checkboxes are gone. Assignment submissions, poll
	// votes and the learning paths people chose to go stay.
	public async resetProgress(userId: EntityId, roomId: EntityId, userIds?: EntityId[]): Promise<void> {
		this.checkFeatureEnabled();

		const paths = await this.learningPathStateService.findRoomPaths(roomId);
		if (paths.length === 0) {
			throw new NotFoundException('The room has no learning paths');
		}

		const { user, auth } = await this.authorize(userId, paths[0]);
		throwForbiddenIfFalse(this.boardNodeRule.can('isBoardEditor', user, auth));

		const students = auth.users.filter((member) => !this.learningPathStateService.isEditor(member));
		const studentIds = new Set(students.map((student) => student.userId));
		if (userIds?.some((id) => !studentIds.has(id))) {
			throw new BadRequestException('Only students of the room can be reset');
		}
		const targets = new Set(userIds ?? students.map((student) => student.userId));

		const boards = await this.columnBoardService.findByExternalReference(
			{ type: BoardExternalReferenceType.Room, id: roomId },
			0
		);
		const boardIds = boards.filter((board) => board.hasColumns()).map((board) => board.id);

		await this.boardCompletionRepo.deleteByBoardIdsAndUserIds(boardIds, Array.from(targets));
		await this.learningPathStateService.clearCheckboxes(boardIds, Array.from(targets));

		paths.forEach((path) => this.learningPathNotifier.changed(path.id));
	}

	public async deleteStep(userId: EntityId, stepId: EntityId): Promise<void> {
		this.checkFeatureEnabled();

		const { step, board } = await this.findStep(stepId);
		await this.checkEditor(userId, board);

		const followers = this.learningPathStateService
			.getSteps(board)
			.filter((sibling) => sibling.prerequisiteStepIds.includes(step.id));
		followers.forEach((follower) => follower.removePrerequisite(step.id));

		await this.boardNodeService.delete(step);
		if (followers.length > 0) {
			await this.boardNodeService.save(followers);
		}
		this.learningPathNotifier.changed(board.id);
	}

	public async getCompletion(userId: EntityId, boardId: EntityId): Promise<BoardCompletionView> {
		if (!this.config.featureBoardLearningPathEnabled) {
			return NO_COMPLETION;
		}

		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId, 0);

		return await this.completionOf(userId, board);
	}

	public async setCompletion(userId: EntityId, boardId: EntityId, completed: boolean): Promise<BoardCompletionView> {
		this.checkFeatureEnabled();

		const current = await this.getCompletion(userId, boardId);
		if (!current.canMarkManually) {
			throw new ForbiddenException('This board cannot be marked as done by hand');
		}

		if (completed) {
			await this.boardCompletionRepo.markCompleted(userId, boardId, 'manual');
		} else {
			await this.boardCompletionRepo.deleteOne(userId, boardId);
		}

		return { ...current, completed };
	}

	// the same for a card that is a step of a learning path
	public async getCardCompletion(userId: EntityId, cardId: EntityId): Promise<BoardCompletionView> {
		if (!this.config.featureBoardLearningPathEnabled) {
			return NO_COMPLETION;
		}

		const card = await this.boardNodeService.findByClassAndId(Card, cardId, 0);
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, card.rootId, 0);

		return await this.completionOf(userId, board, card);
	}

	public async setCardCompletion(userId: EntityId, cardId: EntityId, completed: boolean): Promise<BoardCompletionView> {
		this.checkFeatureEnabled();

		const current = await this.getCardCompletion(userId, cardId);
		if (!current.canMarkManually) {
			throw new ForbiddenException('This card cannot be marked as done by hand');
		}

		if (completed) {
			const card = await this.boardNodeService.findByClassAndId(Card, cardId, 0);
			await this.boardCompletionRepo.markCompleted(userId, cardId, 'manual', card.rootId);
		} else {
			await this.boardCompletionRepo.deleteOne(userId, cardId);
		}

		return { ...current, completed };
	}

	// The cards of the board that are steps of a learning path, for a hint on them.
	public async getBoardCardSteps(userId: EntityId, boardId: EntityId): Promise<Map<EntityId, LearningPathCardStep[]>> {
		if (!this.config.featureBoardLearningPathEnabled) {
			return new Map();
		}

		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId, 0);
		const { user, auth } = await this.authorize(userId, board);
		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, auth));

		return await this.learningPathStateService.cardStepsOnBoard(board, this.findMember(auth, userId));
	}

	private async completionOf(userId: EntityId, board: ColumnBoard, card?: Card): Promise<BoardCompletionView> {
		const { user, auth } = await this.authorize(userId, board);
		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, auth));

		const paths = card
			? await this.learningPathStateService.findPublishedPathsForCard(card.id)
			: await this.learningPathStateService.findPublishedPaths(board.id);
		if (paths.length === 0) {
			return NO_COMPLETION;
		}

		const member = auth.users.find((candidate) => candidate.userId === userId);
		if (!member || this.learningPathStateService.isEditor(member)) {
			return { inLearningPath: true, canMarkManually: false, completed: false };
		}

		const [hasItems, completed] = await Promise.all([
			this.boardProgressService.hasProgressItemsFor(
				board,
				member,
				this.learningPathStateService.enabledTypes(),
				card?.id
			),
			card
				? this.learningPathStateService.completionState([], [member], [card])
				: this.learningPathStateService.completionState([board], [member]),
		]);

		return {
			inLearningPath: true,
			canMarkManually: !hasItems,
			completed: completed.done.get(card?.id ?? board.id)?.has(userId) ?? false,
		};
	}

	// A board or card once completed through its progress stays completed, even when the teacher
	// adds new items later - otherwise the path behind it would lock again.
	private async keepCompletions(userId: EntityId, doneSteps: LearningPathStep[]): Promise<void> {
		if (doneSteps.length === 0) return;

		const targetIds = doneSteps.map((step) => step.targetId);
		const existing = new Set(
			(await this.boardCompletionRepo.findByBoardIds(targetIds, [userId])).map((completion) => completion.boardId)
		);
		const missing = doneSteps.filter((step) => !existing.has(step.targetId));
		await Promise.all(
			missing.map((step) =>
				this.boardCompletionRepo.markCompleted(
					userId,
					step.targetId,
					'progress',
					step.linkedCardId ? step.linkedBoardId : undefined
				)
			)
		);
	}

	private async authorizeEnrollment(
		userId: EntityId,
		boardId: EntityId,
		targetUserId?: EntityId
	): Promise<{ board: ColumnBoard; subject: EntityId }> {
		this.checkFeatureEnabled();

		const board = await this.findLearningPath(boardId);
		if (board.context.type !== BoardExternalReferenceType.Room) {
			throw new BadRequestException('Learning paths can only be part of rooms');
		}

		const { user, auth } = await this.authorize(userId, board);
		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, auth));

		const subject = targetUserId ?? userId;
		if (subject !== userId) {
			throwForbiddenIfFalse(this.boardNodeRule.can('isBoardEditor', user, auth));
			if (!auth.users.some((member) => member.userId === subject)) {
				throw new BadRequestException('The person is not a member of the room');
			}
		}

		return { board, subject };
	}

	// The arrows of all learning paths of a room together must lead somewhere: a board that comes
	// before itself would block everybody who goes both paths.
	private async checkNoCircleInRoom(
		board: ColumnBoard,
		step: LearningPathStep,
		prerequisiteStepIds: EntityId[]
	): Promise<void> {
		if (board.context.type !== BoardExternalReferenceType.Room) return;

		const paths = await this.learningPathStateService.findRoomPaths(board.context.id);
		const steps = paths.flatMap((path) => this.learningPathStateService.getSteps(path));
		if (wouldCreateBoardCycle(steps, step.id, prerequisiteStepIds)) {
			throw new BadRequestException(
				'The arrows would form a circle together with the other learning paths of the room'
			);
		}
	}

	private async findAvailableBoards(pathBoard: ColumnBoard): Promise<ColumnBoard[]> {
		const boards = await this.columnBoardService.findByExternalReference(pathBoard.context, 0);

		return boards.filter((board) => board.hasColumns()).sort((a, b) => a.title.localeCompare(b.title));
	}

	private async findLearningPath(boardId: EntityId): Promise<ColumnBoard> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId, 1);
		if (!board.isLearningPath()) {
			throw new NotFoundException('The board is not a learning path');
		}

		return board;
	}

	private async findStep(stepId: EntityId): Promise<{ step: LearningPathStep; board: ColumnBoard }> {
		const step = await this.boardNodeService.findByClassAndId(LearningPathStep, stepId, 0);
		const board = await this.findLearningPath(step.rootId);
		const loadedStep = this.learningPathStateService.getSteps(board).find((sibling) => sibling.id === step.id);
		if (!loadedStep) {
			throw new NotFoundException('Step not found');
		}

		return { step: loadedStep, board };
	}

	private isSameRoom(pathBoard: ColumnBoard, board: ColumnBoard): boolean {
		return (
			pathBoard.context.type === BoardExternalReferenceType.Room &&
			board.context.type === BoardExternalReferenceType.Room &&
			pathBoard.context.id === board.context.id
		);
	}

	private async checkEditor(userId: EntityId, board: ColumnBoard): Promise<void> {
		const { user, auth } = await this.authorize(userId, board);

		throwForbiddenIfFalse(this.boardNodeRule.can('isBoardEditor', user, auth));
	}

	private async authorize(userId: EntityId, board: ColumnBoard): Promise<{ user: User; auth: BoardNodeAuthorizable }> {
		const [user, auth] = await Promise.all([
			this.authorizationService.getUserWithPermissions(userId),
			this.boardNodeAuthorizableService.getBoardAuthorizable(board),
		]);

		return { user, auth };
	}

	private findMember(auth: BoardNodeAuthorizable, userId: EntityId): UserWithBoardRoles {
		const member = auth.users.find((candidate) => candidate.userId === userId);
		if (!member) {
			throw new ForbiddenException();
		}

		return member;
	}

	private checkFeatureEnabled(): void {
		if (!this.config.featureBoardLearningPathEnabled) {
			throw new ForbiddenException('Learning paths are not enabled.');
		}
	}
}
