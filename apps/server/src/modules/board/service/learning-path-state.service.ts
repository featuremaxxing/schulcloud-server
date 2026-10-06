import { Inject, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import {
	BoardExternalReferenceType,
	BoardNodeType,
	BoardRoles,
	type Card,
	ColumnBoard,
	isCard,
	isColumnBoard,
	isLearningPathStep,
	isLinkElement,
	isRichTextElement,
	isTeacherMember,
	type LearningPathColor,
	orderedSteps,
	pathSegmentOf,
	type LearningPathStep,
	type UserWithBoardRoles,
} from '../domain';
import { BoardCompletionRepo, BoardNodeRepo, LearningPathEnrollmentRepo } from '../repo';
import { BoardNodeService } from './board-node.service';
import { BoardProgressService } from './board-progress.service';

export type LearningPathStepStatus = 'done' | 'open' | 'locked' | 'unavailable';

export type LearningPathLockReason = 'prerequisites' | 'chooseLearningPath';

// Why a board is closed for a person: the learning path that closes it and whether the person
// still has to complete boards of it or has not chosen a learning path at all.
export interface LearningPathLock {
	pathId: EntityId;
	pathTitle: string;
	reason: LearningPathLockReason;
}

// Per board or card (by id), the people who ...
// - done: are done with it right now
// - unlocked: have ever been done with it (a stored completion stays when the teacher adds more
//   items later, so what it unlocked stays open) or are done now
export interface CompletionState {
	done: Map<EntityId, Set<EntityId>>;
	unlocked: Map<EntityId, Set<EntityId>>;
}

export interface LearningPathStepState {
	step: LearningPathStep;
	// undefined when the linked board is gone
	linkedBoard?: ColumnBoard;
	// card steps: undefined when the card is gone
	linkedCard?: Card;
	status: LearningPathStepStatus;
	// the board was completed before but something new came up, so it is not done any more. It
	// still unlocks what follows.
	reopened: boolean;
}

export interface LearningPathSummaryStep {
	step: LearningPathStep;
	// empty when a student may not see the board yet (draft) or the board is gone
	title: string;
	// card steps: the board the card lies on
	boardTitle?: string;
	isVisible: boolean;
	status: LearningPathStepStatus;
	// students: completed before, but something new came up
	reopened?: boolean;
	// students: why a locked step is locked, which may be another learning path they go
	lock?: LearningPathLock;
	// editors: the students who go this learning path and completed the board
	doneCount?: number;
	studentCount?: number;
}

export interface LearningPathSummary {
	color?: LearningPathColor;
	steps: LearningPathSummaryStep[];
	// students: whether they go this learning path, and whether there is a choice at all
	// (a room with a single published learning path has everybody go it)
	isEnrolled?: boolean;
	canChoose?: boolean;
	// editors: the students who go this learning path, and how many of them completed every board
	studentCount?: number;
	completedStudentCount?: number;
}

// A card of a board that is a step of a learning path: which one, where and how far the person is.
export interface LearningPathCardStep {
	pathId: EntityId;
	pathTitle: string;
	color?: LearningPathColor;
	position: number;
	status: LearningPathStepStatus;
}

// The published learning paths of a room with what is needed to judge them for people.
export interface RoomLearningPaths {
	paths: ColumnBoard[];
	linkedBoards: Map<EntityId, ColumnBoard>;
	linkedCards: Map<EntityId, Card>;
	completion: CompletionState;
	// per person, the learning paths they chose to go
	enrolledPathIds: Map<EntityId, Set<EntityId>>;
}

export interface LearningPathOverviewStudent {
	userId: EntityId;
	firstName?: string;
	lastName?: string;
	// every learning path of the room: whether the student goes it, and how far they got (completed
	// boards count in every learning path, so a path can be completed without going it any more)
	paths: {
		pathId: EntityId;
		isEnrolled: boolean;
		completed: boolean;
		done: number;
		total: number;
		rework: number;
		nextBoardTitle?: string;
	}[];
}

export interface LearningPathOverview {
	paths: { id: EntityId; title: string; color?: LearningPathColor; total: number }[];
	students: LearningPathOverviewStudent[];
}

// Which boards of a learning path a person has completed, and which are still locked for them.
// A board is completed when the person marked it as done (boards without progress items) or
// finished all its progress items. A step whose board is gone or still a draft never blocks
// anyone, so a path cannot get stuck because of it.
//
// A person goes the learning paths they enrolled in; in a room with a single published learning
// path everybody goes that one. A board is locked for a person when one of the learning paths they
// go keeps it closed until the boards before it are done, so all of them have to be done. Learning
// paths the person does not go lock nothing for them. Without a learning path, boards that a
// learning path of the room keeps closed stay closed: the person has to choose one first.
@Injectable()
export class LearningPathStateService {
	constructor(
		private readonly boardNodeRepo: BoardNodeRepo,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardProgressService: BoardProgressService,
		private readonly boardCompletionRepo: BoardCompletionRepo,
		private readonly learningPathEnrollmentRepo: LearningPathEnrollmentRepo,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig
	) {}

	public getSteps(pathBoard: ColumnBoard): LearningPathStep[] {
		return pathBoard.children.filter(isLearningPathStep);
	}

	public async loadLinkedBoards(steps: LearningPathStep[]): Promise<Map<EntityId, ColumnBoard>> {
		const ids = Array.from(new Set(steps.map((step) => step.linkedBoardId)));
		const boards = ids.length > 0 ? await this.boardNodeService.findByIds(ids, 0) : [];

		return new Map(boards.filter(isColumnBoard).map((board) => [board.id, board]));
	}

	// the cards of card steps, with their elements (for a title)
	public async loadLinkedCards(steps: LearningPathStep[]): Promise<Map<EntityId, Card>> {
		const ids = Array.from(
			new Set(steps.map((step) => step.linkedCardId).filter((id): id is EntityId => id !== undefined))
		);
		const cards = ids.length > 0 ? await this.boardNodeService.findByIds(ids, 1) : [];

		return new Map(cards.filter(isCard).map((card) => [card.id, card]));
	}

	// What a step is called: the board's title, or for a card its title - or, for a card without
	// one, what it links to or the start of its text.
	public stepTitle(step: LearningPathStep, linkedBoard?: ColumnBoard, linkedCard?: Card): string {
		if (!step.linkedCardId) {
			return linkedBoard?.title ?? '';
		}
		if (!linkedCard) {
			return '';
		}
		if (linkedCard.title?.trim()) {
			return linkedCard.title.trim();
		}

		const link = linkedCard.children.find(isLinkElement);
		if (link?.title?.trim()) {
			return link.title.trim();
		}
		const text = linkedCard.children.find(isRichTextElement)?.text ?? '';
		const plain = text
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		return plain.length > 60 ? `${plain.slice(0, 57)}...` : plain;
	}

	// A person is done with a board when they finished all its progress items, or - on a board
	// without progress items for them - marked it as done by hand. A stored completion alone keeps
	// the boards after it open, even when the teacher added items since (see CompletionState).
	// Cards the same way, by the items on them.
	public async completionState(
		boards: ColumnBoard[],
		users: UserWithBoardRoles[],
		cards: Card[] = []
	): Promise<CompletionState> {
		const targetIds = [...boards.map((board) => board.id), ...cards.map((card) => card.id)];
		const [progress, completions] = await Promise.all([
			this.boardProgressService.computeCompletedUserIds(
				boards.map((board) => {
					return { board, users };
				}),
				this.enabledTypes(),
				cards.map((card) => {
					return { cardId: card.id, boardId: card.rootId, users };
				})
			),
			this.boardCompletionRepo.findByBoardIds(targetIds),
		]);

		const done = new Map<EntityId, Set<EntityId>>();
		const unlocked = new Map<EntityId, Set<EntityId>>();
		for (const id of targetIds) {
			const targetDone = new Set(progress.done.get(id));
			done.set(id, targetDone);
			unlocked.set(id, new Set(targetDone));
		}
		for (const completion of completions) {
			unlocked.get(completion.boardId)?.add(completion.userId);
			if (!progress.withItems.get(completion.boardId)?.has(completion.userId)) {
				done.get(completion.boardId)?.add(completion.userId);
			}
		}

		return { done, unlocked };
	}

	public computeStates(
		steps: LearningPathStep[],
		linkedBoards: Map<EntityId, ColumnBoard>,
		completion: CompletionState,
		userId: EntityId,
		linkedCards: Map<EntityId, Card> = new Map()
	): LearningPathStepState[] {
		const stepsById = new Map(steps.map((step) => [step.id, step]));

		const isAvailable = (step: LearningPathStep): boolean => this.isAvailable(step, linkedBoards, linkedCards);
		const isDone = (step: LearningPathStep): boolean => completion.done.get(step.targetId)?.has(userId) ?? false;
		const wasDone = (step: LearningPathStep): boolean => completion.unlocked.get(step.targetId)?.has(userId) ?? false;
		// a prerequisite that is gone or not published does not block, and neither does one that
		// was completed once
		const isSatisfied = (stepId: EntityId): boolean => {
			const step = stepsById.get(stepId);
			return !step || !isAvailable(step) || wasDone(step);
		};

		return steps.map((step) => {
			const linkedBoard = linkedBoards.get(step.linkedBoardId);
			const linkedCard = step.linkedCardId ? linkedCards.get(step.linkedCardId) : undefined;
			let status: LearningPathStepStatus;
			if (!isAvailable(step)) {
				status = 'unavailable';
			} else if (isDone(step)) {
				status = 'done';
			} else if (step.lockUntilPrerequisitesDone && !this.prerequisitesMet(step, isSatisfied)) {
				status = 'locked';
			} else {
				status = 'open';
			}

			const reopened = status === 'open' && wasDone(step);

			return { step, linkedBoard, linkedCard, status, reopened };
		});
	}

	// the states of a learning path of the room for the person
	public roomStates(room: RoomLearningPaths, path: ColumnBoard, userId: EntityId): LearningPathStepState[] {
		return this.computeStates(this.getSteps(path), room.linkedBoards, room.completion, userId, room.linkedCards);
	}

	// A step counts when its board is published and, for a card step, the card is still on it.
	public isAvailable(
		step: LearningPathStep,
		linkedBoards: Map<EntityId, ColumnBoard>,
		linkedCards: Map<EntityId, Card>
	): boolean {
		const boardVisible = linkedBoards.get(step.linkedBoardId)?.isVisible ?? false;
		if (!step.linkedCardId) {
			return boardVisible;
		}

		return boardVisible && linkedCards.get(step.linkedCardId)?.rootId === step.linkedBoardId;
	}

	// The published learning paths of a room, loaded with their boards, for the given people.
	// Paths that are not published yet can be added to see them as well (editors).
	public async loadRoomPaths(
		roomId: EntityId,
		users: UserWithBoardRoles[],
		extraPaths: ColumnBoard[] = []
	): Promise<RoomLearningPaths> {
		const nodes = await this.boardNodeRepo.findByExternalReference(
			{ type: BoardExternalReferenceType.Room, id: roomId },
			0
		);
		const publishedIds = nodes
			.filter(isColumnBoard)
			.filter((board) => board.isLearningPath() && board.isVisible)
			.map((board) => board.id);
		const paths =
			publishedIds.length > 0 ? (await this.boardNodeService.findByIds(publishedIds, 1)).filter(isColumnBoard) : [];

		const allSteps = [...paths, ...extraPaths].flatMap((path) => this.getSteps(path));
		const [linkedBoards, linkedCards] = await Promise.all([
			this.loadLinkedBoards(allSteps),
			this.loadLinkedCards(allSteps),
		]);
		const [completion, enrollments] = await Promise.all([
			this.completionState(Array.from(linkedBoards.values()), users, Array.from(linkedCards.values())),
			this.learningPathEnrollmentRepo.findByRoom(roomId),
		]);

		const enrolledPathIds = new Map<EntityId, Set<EntityId>>();
		for (const enrollment of enrollments) {
			const chosen = enrolledPathIds.get(enrollment.userId) ?? new Set<EntityId>();
			chosen.add(enrollment.pathBoardId);
			enrolledPathIds.set(enrollment.userId, chosen);
		}

		return { paths, linkedBoards, linkedCards, completion, enrolledPathIds };
	}

	// Every learning path of the room, published or not, loaded with its boards.
	public async findRoomPaths(roomId: EntityId): Promise<ColumnBoard[]> {
		const nodes = await this.boardNodeRepo.findByExternalReference(
			{ type: BoardExternalReferenceType.Room, id: roomId },
			0
		);
		const ids = nodes
			.filter(isColumnBoard)
			.filter((board) => board.isLearningPath())
			.map((board) => board.id);

		return ids.length > 0 ? (await this.boardNodeService.findByIds(ids, 1)).filter(isColumnBoard) : [];
	}

	// Whether the person goes the learning path: they enrolled in it, or it is the only
	// published one of the room.
	public isEnrolled(room: RoomLearningPaths, userId: EntityId, pathId: EntityId): boolean {
		if (room.paths.length === 1 && room.paths[0].id === pathId) {
			return true;
		}

		return room.enrolledPathIds.get(userId)?.has(pathId) ?? false;
	}

	public ownPaths(room: RoomLearningPaths, userId: EntityId): ColumnBoard[] {
		return room.paths.filter((path) => this.isEnrolled(room, userId, path.id));
	}

	// The boards of the room that are closed for the person, by the learning path that closes them.
	// Card steps never close anything: the card stays on its board, the learning path only guides.
	public locksFor(room: RoomLearningPaths, userId: EntityId): Map<EntityId, LearningPathLock> {
		const locks = new Map<EntityId, LearningPathLock>();
		const own = this.ownPaths(room, userId);

		if (own.length === 0) {
			// no learning path chosen yet: what a learning path of the room keeps closed stays closed
			for (const path of room.paths) {
				for (const { step, status } of this.roomStates(room, path, userId)) {
					if (status === 'locked' && !step.linkedCardId && !locks.has(step.linkedBoardId)) {
						locks.set(step.linkedBoardId, {
							pathId: path.id,
							pathTitle: path.title,
							reason: 'chooseLearningPath',
						});
					}
				}
			}

			return locks;
		}

		for (const path of own) {
			for (const { step, status } of this.roomStates(room, path, userId)) {
				if (status === 'locked' && !step.linkedCardId && !locks.has(step.linkedBoardId)) {
					locks.set(step.linkedBoardId, { pathId: path.id, pathTitle: path.title, reason: 'prerequisites' });
				}
			}
		}

		return locks;
	}

	// The people the given boards are locked for, per board. Only boards that are linked by
	// a step with lockUntilPrerequisitesDone on a published learning path can be locked at
	// all; board editors never are.
	public async lockedUserIds(boards: ColumnBoard[], users: UserWithBoardRoles[]): Promise<Map<EntityId, EntityId[]>> {
		const result = new Map<EntityId, EntityId[]>();
		if (!this.config.featureBoardLearningPathEnabled) {
			return result;
		}

		const candidates = boards.filter(
			(board) => board.hasColumns() && board.context.type === BoardExternalReferenceType.Room
		);
		// card steps never lock (see locksFor)
		const linkingSteps = (
			await this.boardNodeRepo.findLearningPathStepsLinking(candidates.map((board) => board.id))
		).filter((step) => !step.linkedCardId);
		const lockable = users.filter((user) => !this.isEditor(user));
		if (!linkingSteps.some((step) => step.lockUntilPrerequisitesDone) || lockable.length === 0) {
			return result;
		}

		const roomIds = Array.from(new Set(candidates.map((board) => board.context.id)));
		for (const roomId of roomIds) {
			const room = await this.loadRoomPaths(roomId, lockable);
			if (room.paths.length > 0) {
				const locksByUser = new Map(lockable.map((user) => [user.userId, this.locksFor(room, user.userId)]));

				for (const board of candidates.filter((candidate) => candidate.context.id === roomId)) {
					const locked = lockable
						.filter((user) => locksByUser.get(user.userId)?.has(board.id))
						.map((user) => user.userId);
					if (locked.length > 0) {
						result.set(board.id, locked);
					}
				}
			}
		}

		return result;
	}

	// A short overview of each given learning path, for the learning path itself and the room page.
	// Students see their own states, with the locks that apply to them; editors see every board as
	// configured and how the students who go the learning path are doing. The learning paths have to
	// be loaded with their children, all of them in the same room.
	public async summarize(
		paths: { board: ColumnBoard; users: UserWithBoardRoles[]; isEditor: boolean }[],
		userId: EntityId
	): Promise<Map<EntityId, LearningPathSummary>> {
		const result = new Map<EntityId, LearningPathSummary>();
		if (!this.config.featureBoardLearningPathEnabled || paths.length === 0) {
			return result;
		}

		// the room lists its boards without children
		const loaded = (
			await this.boardNodeService.findByIds(
				paths.map((path) => path.board.id),
				1
			)
		).filter(isColumnBoard);
		const loadedById = new Map(loaded.map((board) => [board.id, board]));

		const relevantUsers = new Map<EntityId, UserWithBoardRoles>();
		for (const path of paths) {
			const relevant = path.isEditor
				? path.users.filter((member) => !this.isEditor(member))
				: path.users.filter((member) => member.userId === userId);
			relevant.forEach((member) => relevantUsers.set(member.userId, member));
		}

		const room = await this.loadRoomPaths(paths[0].board.context.id, Array.from(relevantUsers.values()), loaded);

		for (const path of paths) {
			const board = loadedById.get(path.board.id) ?? path.board;
			const steps = this.getSteps(board);

			if (path.isEditor) {
				result.set(path.board.id, this.summarizeForEditor(room, board, steps, path.users));
			} else {
				result.set(path.board.id, this.summarizeForStudent(room, board, steps, userId));
			}
		}

		return result;
	}

	// Who goes which learning path of the room and how far they are, for the room's editors.
	public async overview(roomId: EntityId, users: UserWithBoardRoles[]): Promise<LearningPathOverview> {
		const students = users.filter((member) => !this.isEditor(member));
		const room = await this.loadRoomPaths(roomId, students);

		const stepsByPath = new Map(room.paths.map((path) => [path.id, this.getSteps(path)]));
		const isPublished = (step: LearningPathStep): boolean =>
			this.isAvailable(step, room.linkedBoards, room.linkedCards);

		return {
			paths: room.paths.map((path) => {
				return {
					id: path.id,
					title: path.title,
					color: path.learningPathColor,
					total: (stepsByPath.get(path.id) ?? []).filter(isPublished).length,
				};
			}),
			students: students.map((student) => {
				const locks = this.locksFor(room, student.userId);
				const own = new Set(this.ownPaths(room, student.userId).map((path) => path.id));

				return {
					userId: student.userId,
					firstName: student.firstName,
					lastName: student.lastName,
					paths: room.paths.map((path) => {
						const states = this.roomStates(room, path, student.userId).filter(
							(state) => state.status !== 'unavailable'
						);
						const next = states
							.filter(
								(state) =>
									state.status !== 'done' &&
									state.status !== 'locked' &&
									(!!state.step.linkedCardId || !locks.has(state.step.linkedBoardId))
							)
							.sort((a, b) => a.step.positionY - b.step.positionY || a.step.positionX - b.step.positionX)[0];

						const done = states.filter((state) => state.status === 'done').length;

						return {
							pathId: path.id,
							isEnrolled: own.has(path.id),
							completed: states.length > 0 && done === states.length,
							done,
							total: states.length,
							rework: states.filter((state) => state.reopened).length,
							nextBoardTitle: next ? this.stepTitle(next.step, next.linkedBoard, next.linkedCard) : undefined,
						};
					}),
				};
			}),
		};
	}

	// The cards of the board that are steps of a learning path, per card the learning paths with the
	// step's number - for a hint on the card. Students see the learning paths they go (all of them as
	// long as they have not chosen one) with their state, editors every published one.
	public async cardStepsOnBoard(
		board: ColumnBoard,
		member: UserWithBoardRoles
	): Promise<Map<EntityId, LearningPathCardStep[]>> {
		const result = new Map<EntityId, LearningPathCardStep[]>();
		if (!this.config.featureBoardLearningPathEnabled || board.context.type !== BoardExternalReferenceType.Room) {
			return result;
		}

		const linking = await this.boardNodeRepo.findLearningPathStepsLinking([board.id]);
		if (!linking.some((step) => step.linkedCardId)) {
			return result;
		}

		const isEditor = this.isEditor(member);
		const room = await this.loadRoomPaths(board.context.id, [member]);
		const own = this.ownPaths(room, member.userId);
		const paths = isEditor || own.length === 0 ? room.paths : own;

		for (const path of paths) {
			const states = this.roomStates(room, path, member.userId).filter((state) => state.status !== 'unavailable');
			const statusOf = new Map(states.map((state) => [state.step.id, state.status]));
			orderedSteps(states.map((state) => state.step)).forEach((step, index) => {
				if (!step.linkedCardId || step.linkedBoardId !== board.id) return;

				const entries = result.get(step.linkedCardId) ?? [];
				entries.push({
					pathId: path.id,
					pathTitle: path.title,
					color: path.learningPathColor,
					position: index + 1,
					status: isEditor ? 'open' : (statusOf.get(step.id) ?? 'open'),
				});
				result.set(step.linkedCardId, entries);
			});
		}

		return result;
	}

	// The published learning paths the board (as a whole) is part of.
	public async findPublishedPaths(boardId: EntityId): Promise<ColumnBoard[]> {
		const steps = (await this.boardNodeRepo.findLearningPathStepsLinking([boardId])).filter(
			(step) => !step.linkedCardId
		);

		return await this.publishedPathsOf(steps);
	}

	// The published learning paths the card is a step of.
	public async findPublishedPathsForCard(cardId: EntityId): Promise<ColumnBoard[]> {
		const steps = await this.boardNodeRepo.findLearningPathStepsLinkingCards([cardId]);

		return await this.publishedPathsOf(steps);
	}

	private async publishedPathsOf(steps: LearningPathStep[]): Promise<ColumnBoard[]> {
		if (steps.length === 0) return [];

		const pathBoards = await this.boardNodeService.findByIds(Array.from(new Set(steps.map((step) => step.rootId))), 0);

		return pathBoards.filter(isColumnBoard).filter((pathBoard) => pathBoard.isLearningPath() && pathBoard.isVisible);
	}

	// For each given board of a room, the learning path that locks it for the person (to name it
	// in the room) and why.
	public async findLocks(boards: ColumnBoard[], member: UserWithBoardRoles): Promise<Map<EntityId, LearningPathLock>> {
		const result = new Map<EntityId, LearningPathLock>();
		if (boards.length === 0) {
			return result;
		}

		const roomIds = Array.from(new Set(boards.map((board) => board.context.id)));
		for (const roomId of roomIds) {
			const room = await this.loadRoomPaths(roomId, [member]);
			const locks = this.locksFor(room, member.userId);
			for (const board of boards.filter((candidate) => candidate.context.id === roomId)) {
				const lock = locks.get(board.id);
				if (lock) {
					result.set(board.id, lock);
				}
			}
		}

		return result;
	}

	// Remembers who has completed the board - and the given card of it - right now. Called before
	// a progress item is added to the card: from then on there is something new to do, but what the
	// completion unlocked stays. Only boards and cards that are steps of a learning path are of interest.
	public async rememberCompletions(board: ColumnBoard, users: UserWithBoardRoles[], card?: Card): Promise<void> {
		if (
			!this.config.featureBoardLearningPathEnabled ||
			!board.hasColumns() ||
			board.context.type !== BoardExternalReferenceType.Room
		) {
			return;
		}

		const steps = await this.boardNodeRepo.findLearningPathStepsLinking([board.id]);
		const boardIsStep = steps.some((step) => !step.linkedCardId);
		const cardIsStep = !!card && steps.some((step) => step.linkedCardId === card.id);
		const students = users.filter((user) => !this.isEditor(user));
		if ((!boardIsStep && !cardIsStep) || students.length === 0) {
			return;
		}

		const completion = await this.completionState(
			boardIsStep ? [board] : [],
			students,
			cardIsStep && card ? [card] : []
		);
		const marks: Promise<void>[] = [];
		if (boardIsStep) {
			const doneIds = Array.from(completion.done.get(board.id) ?? []);
			marks.push(...doneIds.map((id) => this.boardCompletionRepo.markCompleted(id, board.id, 'progress')));
		}
		if (cardIsStep && card) {
			const doneIds = Array.from(completion.done.get(card.id) ?? []);
			marks.push(...doneIds.map((id) => this.boardCompletionRepo.markCompleted(id, card.id, 'progress', board.id)));
		}
		await Promise.all(marks);
	}

	// A card moved to another board: within the room its steps and completions follow it, out of
	// the room it leaves the learning paths.
	public async cardMoved(cardId: EntityId, fromBoard: ColumnBoard, toBoard: ColumnBoard): Promise<void> {
		const steps = await this.boardNodeRepo.findLearningPathStepsLinkingCards([cardId]);
		if (steps.length === 0) {
			return;
		}

		const sameRoom =
			toBoard.context.type === BoardExternalReferenceType.Room &&
			toBoard.context.id === fromBoard.context.id &&
			toBoard.hasColumns();
		if (sameRoom) {
			// one after the other: both flush the same entity manager
			await this.boardNodeRepo.updateLearningPathStepsLinkingCard(cardId, toBoard.id);
			await this.boardCompletionRepo.updateCardBoard(cardId, toBoard.id);
		} else {
			await Promise.all([
				this.boardNodeRepo.removeLearningPathStepsLinkingCard(cardId),
				this.boardCompletionRepo.deleteByCardId(cardId),
			]);
		}
	}

	// Takes the ticks of the given people off every checkbox of the boards, and of the given cards.
	public async clearCheckboxes(
		boardIds: EntityId[],
		userIds: EntityId[],
		cards: { cardId: EntityId; boardId: EntityId }[] = []
	): Promise<void> {
		const targets = new Set(userIds);
		const wholeBoards = new Set(boardIds);
		const cardIds = new Set(cards.map((card) => card.cardId));
		const searched = Array.from(new Set([...boardIds, ...cards.map((card) => card.boardId)]));
		const checkboxes = (
			await this.boardNodeRepo.findElementsByBoardIds(searched, [BoardNodeType.CHECKBOX_ELEMENT])
		).filter(
			(checkbox) => wholeBoards.has(pathSegmentOf(checkbox, 0) ?? '') || cardIds.has(pathSegmentOf(checkbox, 2) ?? '')
		);

		await Promise.all(
			checkboxes.map((checkbox) =>
				this.boardNodeService.mutateCheckboxEntries(checkbox.id, (entries) =>
					entries.filter((entry) => !targets.has(entry.userId))
				)
			)
		);
	}

	public isEditor(user: UserWithBoardRoles): boolean {
		return user.roles.includes(BoardRoles.EDITOR) || user.roles.includes(BoardRoles.ADMIN) || isTeacherMember(user);
	}

	public enabledTypes(): BoardNodeType[] {
		const types: BoardNodeType[] = [];
		if (this.config.featureColumnBoardCheckboxEnabled) types.push(BoardNodeType.CHECKBOX_ELEMENT);
		if (this.config.featureColumnBoardAssignmentEnabled) types.push(BoardNodeType.ASSIGNMENT_ELEMENT);
		if (this.config.featureColumnBoardPollEnabled) types.push(BoardNodeType.POLL_ELEMENT);
		return types;
	}

	private summarizeForEditor(
		room: RoomLearningPaths,
		board: ColumnBoard,
		steps: LearningPathStep[],
		users: UserWithBoardRoles[]
	): LearningPathSummary {
		const students = users.filter((member) => !this.isEditor(member));
		const enrolled = students.filter((student) => this.isEnrolled(room, student.userId, board.id));
		const published = steps.filter((step) => this.isAvailable(step, room.linkedBoards, room.linkedCards));
		const completedStudentCount = enrolled.filter(
			(student) =>
				published.length > 0 && published.every((step) => room.completion.done.get(step.targetId)?.has(student.userId))
		).length;

		return {
			color: board.learningPathColor,
			steps: steps.map((step) => {
				const linkedBoard = room.linkedBoards.get(step.linkedBoardId);
				const linkedCard = step.linkedCardId ? room.linkedCards.get(step.linkedCardId) : undefined;
				const exists = !!linkedBoard && (!step.linkedCardId || linkedCard?.rootId === step.linkedBoardId);
				const done = enrolled.filter((student) => room.completion.done.get(step.targetId)?.has(student.userId));
				return {
					step,
					title: this.stepTitle(step, linkedBoard, linkedCard),
					boardTitle: step.linkedCardId ? linkedBoard?.title : undefined,
					isVisible: linkedBoard?.isVisible ?? false,
					status: exists ? 'open' : 'unavailable',
					doneCount: done.length,
					studentCount: enrolled.length,
				};
			}),
			studentCount: enrolled.length,
			completedStudentCount,
		};
	}

	private summarizeForStudent(
		room: RoomLearningPaths,
		board: ColumnBoard,
		steps: LearningPathStep[],
		userId: EntityId
	): LearningPathSummary {
		const locks = this.locksFor(room, userId);
		const states = this.computeStates(steps, room.linkedBoards, room.completion, userId, room.linkedCards);
		// card steps only guide: they show as locked in the learning paths the person goes - or in
		// every one while they have not chosen any - but never close the card
		const own = this.ownPaths(room, userId);
		const goesPath = own.some((path) => path.id === board.id);
		const cardLock = (status: LearningPathStepStatus): LearningPathLock | undefined => {
			if (status !== 'locked' || (!goesPath && own.length > 0)) return undefined;
			return { pathId: board.id, pathTitle: board.title, reason: goesPath ? 'prerequisites' : 'chooseLearningPath' };
		};

		return {
			color: board.learningPathColor,
			isEnrolled: this.isEnrolled(room, userId, board.id),
			canChoose: room.paths.length > 1,
			steps: states.map((state): LearningPathSummaryStep => {
				const visible = state.status !== 'unavailable';
				// what the server enforces: done and unavailable as they are, the rest by the locks of the learning paths the person goes
				const lock =
					state.status === 'done' || !visible
						? undefined
						: state.step.linkedCardId
							? cardLock(state.status)
							: locks.get(state.step.linkedBoardId);

				const status = !visible || state.status === 'done' ? state.status : lock ? 'locked' : 'open';

				return {
					step: state.step,
					title: visible ? this.stepTitle(state.step, state.linkedBoard, state.linkedCard) : '',
					boardTitle: visible && state.step.linkedCardId ? state.linkedBoard?.title : undefined,
					isVisible: visible,
					status,
					reopened: status === 'open' && state.reopened,
					lock,
				};
			}),
		};
	}

	private prerequisitesMet(step: LearningPathStep, isSatisfied: (stepId: EntityId) => boolean): boolean {
		const prerequisites = step.prerequisiteStepIds;
		if (prerequisites.length === 0) {
			return true;
		}
		return step.unlockMode === 'any' ? prerequisites.some(isSatisfied) : prerequisites.every(isSatisfied);
	}
}
