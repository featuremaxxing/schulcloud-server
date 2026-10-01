import { Inject, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import {
	BoardExternalReferenceType,
	BoardNodeType,
	BoardRoles,
	ColumnBoard,
	isColumnBoard,
	isLearningPathStep,
	isTeacherMember,
	type LearningPathColor,
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

export interface LearningPathStepState {
	step: LearningPathStep;
	// undefined when the linked board is gone
	linkedBoard?: ColumnBoard;
	status: LearningPathStepStatus;
}

export interface LearningPathSummaryStep {
	step: LearningPathStep;
	// empty when a student may not see the board yet (draft) or the board is gone
	title: string;
	isVisible: boolean;
	status: LearningPathStepStatus;
	// students: why a locked step is locked, which may be another learning path they go
	lock?: LearningPathLock;
	// editors: the students who go this learning path and completed the board
	doneCount?: number;
	studentCount?: number;
}

export interface LearningPathSummary {
	color?: LearningPathColor;
	steps: LearningPathSummaryStep[];
	// students: whether they go this learning path
	isEnrolled?: boolean;
	// editors: the students who go this learning path, and how many of them completed every board
	studentCount?: number;
	completedStudentCount?: number;
}

// The published learning paths of a room with what is needed to judge them for people.
export interface RoomLearningPaths {
	paths: ColumnBoard[];
	linkedBoards: Map<EntityId, ColumnBoard>;
	completed: Map<EntityId, Set<EntityId>>;
	// per person, the learning paths they chose to go
	enrolledPathIds: Map<EntityId, Set<EntityId>>;
}

export interface LearningPathOverviewStudent {
	userId: EntityId;
	firstName?: string;
	lastName?: string;
	paths: { pathId: EntityId; done: number; total: number; nextBoardTitle?: string }[];
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

	// Per board: the people who completed it. Manual completions count for everybody,
	// the progress only for people with at least one progress item on the board.
	public async completedUserIds(
		boards: ColumnBoard[],
		users: UserWithBoardRoles[]
	): Promise<Map<EntityId, Set<EntityId>>> {
		const [byProgress, completions] = await Promise.all([
			this.boardProgressService.computeCompletedUserIds(
				boards.map((board) => {
					return { board, users };
				}),
				this.enabledTypes()
			),
			this.boardCompletionRepo.findByBoardIds(boards.map((board) => board.id)),
		]);

		for (const completion of completions) {
			const done = byProgress.get(completion.boardId) ?? new Set<EntityId>();
			done.add(completion.userId);
			byProgress.set(completion.boardId, done);
		}

		return byProgress;
	}

	public computeStates(
		steps: LearningPathStep[],
		linkedBoards: Map<EntityId, ColumnBoard>,
		completed: Map<EntityId, Set<EntityId>>,
		userId: EntityId
	): LearningPathStepState[] {
		const stepsById = new Map(steps.map((step) => [step.id, step]));

		const isAvailable = (step: LearningPathStep): boolean => linkedBoards.get(step.linkedBoardId)?.isVisible ?? false;
		const isDone = (step: LearningPathStep): boolean => completed.get(step.linkedBoardId)?.has(userId) ?? false;
		// a prerequisite that is gone or not published does not block
		const isSatisfied = (stepId: EntityId): boolean => {
			const step = stepsById.get(stepId);
			return !step || !isAvailable(step) || isDone(step);
		};

		return steps.map((step) => {
			const linkedBoard = linkedBoards.get(step.linkedBoardId);
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

			return { step, linkedBoard, status };
		});
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
		const linkedBoards = await this.loadLinkedBoards(allSteps);
		const [completed, enrollments] = await Promise.all([
			this.completedUserIds(Array.from(linkedBoards.values()), users),
			this.learningPathEnrollmentRepo.findByRoom(roomId),
		]);

		const enrolledPathIds = new Map<EntityId, Set<EntityId>>();
		for (const enrollment of enrollments) {
			const chosen = enrolledPathIds.get(enrollment.userId) ?? new Set<EntityId>();
			chosen.add(enrollment.pathBoardId);
			enrolledPathIds.set(enrollment.userId, chosen);
		}

		return { paths, linkedBoards, completed, enrolledPathIds };
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
	public locksFor(room: RoomLearningPaths, userId: EntityId): Map<EntityId, LearningPathLock> {
		const locks = new Map<EntityId, LearningPathLock>();
		const own = this.ownPaths(room, userId);

		if (own.length === 0) {
			// no learning path chosen yet: what a learning path of the room keeps closed stays closed
			for (const path of room.paths) {
				const states = this.computeStates(this.getSteps(path), room.linkedBoards, room.completed, userId);
				for (const { step, status } of states) {
					if (status === 'locked' && !locks.has(step.linkedBoardId)) {
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
			const states = this.computeStates(this.getSteps(path), room.linkedBoards, room.completed, userId);
			for (const { step, status } of states) {
				if (status === 'locked' && !locks.has(step.linkedBoardId)) {
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
		const linkingSteps = await this.boardNodeRepo.findLearningPathStepsLinking(candidates.map((board) => board.id));
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
			room.linkedBoards.get(step.linkedBoardId)?.isVisible ?? false;

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
				const own = this.ownPaths(room, student.userId);

				return {
					userId: student.userId,
					firstName: student.firstName,
					lastName: student.lastName,
					paths: own.map((path) => {
						const states = this.computeStates(
							stepsByPath.get(path.id) ?? [],
							room.linkedBoards,
							room.completed,
							student.userId
						).filter((state) => state.status !== 'unavailable');
						const next = states
							.filter((state) => state.status !== 'done' && !locks.has(state.step.linkedBoardId))
							.sort((a, b) => a.step.positionY - b.step.positionY || a.step.positionX - b.step.positionX)[0];

						return {
							pathId: path.id,
							done: states.filter((state) => state.status === 'done').length,
							total: states.length,
							nextBoardTitle: next?.linkedBoard?.title,
						};
					}),
				};
			}),
		};
	}

	// The published learning paths the board is part of.
	public async findPublishedPaths(boardId: EntityId): Promise<ColumnBoard[]> {
		const steps = await this.boardNodeRepo.findLearningPathStepsLinking([boardId]);
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
		const published = steps.filter((step) => room.linkedBoards.get(step.linkedBoardId)?.isVisible);
		const completedStudentCount = enrolled.filter(
			(student) =>
				published.length > 0 && published.every((step) => room.completed.get(step.linkedBoardId)?.has(student.userId))
		).length;

		return {
			color: board.learningPathColor,
			steps: steps.map((step) => {
				const linkedBoard = room.linkedBoards.get(step.linkedBoardId);
				const done = enrolled.filter((student) => room.completed.get(step.linkedBoardId)?.has(student.userId));
				return {
					step,
					title: linkedBoard?.title ?? '',
					isVisible: linkedBoard?.isVisible ?? false,
					status: linkedBoard ? 'open' : 'unavailable',
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
		const states = this.computeStates(steps, room.linkedBoards, room.completed, userId);

		return {
			color: board.learningPathColor,
			isEnrolled: this.isEnrolled(room, userId, board.id),
			steps: states.map((state): LearningPathSummaryStep => {
				const visible = state.status !== 'unavailable';
				// what the server enforces: done and unavailable as they are, the rest by the locks of the learning paths the person goes
				const lock = state.status === 'done' || !visible ? undefined : locks.get(state.step.linkedBoardId);

				return {
					step: state.step,
					title: visible ? (state.linkedBoard?.title ?? '') : '',
					isVisible: visible,
					status: !visible || state.status === 'done' ? state.status : lock ? 'locked' : 'open',
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
