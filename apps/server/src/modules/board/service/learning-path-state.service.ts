import { Inject, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import {
	BoardNodeType,
	ColumnBoard,
	isColumnBoard,
	isLearningPathStep,
	isTeacherMember,
	type LearningPathStep,
	type UserWithBoardRoles,
	BoardRoles,
} from '../domain';
import { BoardCompletionRepo, BoardNodeRepo } from '../repo';
import { BoardNodeService } from './board-node.service';
import { BoardProgressService } from './board-progress.service';

export type LearningPathStepStatus = 'done' | 'open' | 'locked' | 'unavailable';

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
}

export interface LearningPathSummary {
	steps: LearningPathSummaryStep[];
	// only for editors
	studentCount?: number;
	completedStudentCount?: number;
}

// Which boards of a learning path a person has completed, and which are still locked for them.
// A board is completed when the person marked it as done (boards without progress items) or
// finished all its progress items. A step whose board is gone or still a draft never blocks
// anyone, so a path cannot get stuck because of it.
@Injectable()
export class LearningPathStateService {
	constructor(
		private readonly boardNodeRepo: BoardNodeRepo,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardProgressService: BoardProgressService,
		private readonly boardCompletionRepo: BoardCompletionRepo,
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

	// The people the given boards are locked for, per board. Only boards that are linked by
	// a step with lockUntilPrerequisitesDone on a published learning path can be locked at
	// all; board editors never are. A board linked on several paths is open as soon as one
	// of them lets the person through.
	public async lockedUserIds(boards: ColumnBoard[], users: UserWithBoardRoles[]): Promise<Map<EntityId, EntityId[]>> {
		const result = new Map<EntityId, EntityId[]>();
		if (!this.config.featureBoardLearningPathEnabled) {
			return result;
		}

		const candidates = boards.filter((board) => board.hasColumns());
		const linkingSteps = await this.boardNodeRepo.findLearningPathStepsLinking(candidates.map((board) => board.id));
		if (!linkingSteps.some((step) => step.lockUntilPrerequisitesDone)) {
			return result;
		}

		const pathBoards = (
			await this.boardNodeService.findByIds(Array.from(new Set(linkingSteps.map((s) => s.rootId))), 1)
		)
			.filter(isColumnBoard)
			.filter((pathBoard) => pathBoard.isLearningPath() && pathBoard.isVisible);
		if (pathBoards.length === 0) {
			return result;
		}

		const allSteps = pathBoards.flatMap((pathBoard) => this.getSteps(pathBoard));
		const linkedBoards = await this.loadLinkedBoards(allSteps);
		const lockable = users.filter((user) => !this.isEditor(user));
		const completed = await this.completedUserIds(Array.from(linkedBoards.values()), lockable);

		for (const board of candidates) {
			const locked = lockable
				.filter((user) =>
					this.isLockedFor(
						board.id,
						pathBoards.map((pathBoard) => this.getSteps(pathBoard)),
						linkedBoards,
						completed,
						user.userId
					)
				)
				.map((user) => user.userId);
			if (locked.length > 0) {
				result.set(board.id, locked);
			}
		}

		return result;
	}

	// A short overview of each given learning path for the room page. Students see their own
	// states; editors see every board as configured and how many students completed the whole
	// path (all published boards).
	public async summarize(
		paths: { board: ColumnBoard; users: UserWithBoardRoles[]; isEditor: boolean }[],
		userId: EntityId
	): Promise<Map<EntityId, LearningPathSummary>> {
		const result = new Map<EntityId, LearningPathSummary>();
		if (!this.config.featureBoardLearningPathEnabled || paths.length === 0) {
			return result;
		}

		// the room loads its boards without children
		const loaded = new Map(
			(
				await this.boardNodeService.findByIds(
					paths.map((path) => path.board.id),
					1
				)
			)
				.filter(isColumnBoard)
				.map((board) => [board.id, board])
		);
		const stepsByPath = new Map(
			paths.map((path) => {
				const board = loaded.get(path.board.id);
				return [path.board.id, board ? this.getSteps(board) : []];
			})
		);
		const linkedBoards = await this.loadLinkedBoards(Array.from(stepsByPath.values()).flat());

		const users = new Map<EntityId, UserWithBoardRoles>();
		for (const path of paths) {
			const relevant = path.isEditor
				? path.users.filter((member) => !this.isEditor(member))
				: path.users.filter((member) => member.userId === userId);
			relevant.forEach((member) => users.set(member.userId, member));
		}
		const completed = await this.completedUserIds(Array.from(linkedBoards.values()), Array.from(users.values()));

		for (const path of paths) {
			const steps = stepsByPath.get(path.board.id) ?? [];
			if (path.isEditor) {
				const students = path.users.filter((member) => !this.isEditor(member));
				const published = steps.filter((step) => linkedBoards.get(step.linkedBoardId)?.isVisible);
				const completedStudentCount = students.filter(
					(student) =>
						published.length > 0 && published.every((step) => completed.get(step.linkedBoardId)?.has(student.userId))
				).length;

				result.set(path.board.id, {
					steps: steps.map((step) => {
						const linkedBoard = linkedBoards.get(step.linkedBoardId);
						return {
							step,
							title: linkedBoard?.title ?? '',
							isVisible: linkedBoard?.isVisible ?? false,
							status: linkedBoard ? 'open' : 'unavailable',
						};
					}),
					studentCount: students.length,
					completedStudentCount,
				});
			} else {
				const states = this.computeStates(steps, linkedBoards, completed, userId);
				result.set(path.board.id, {
					steps: states.map((state) => {
						const visible = state.status !== 'unavailable';
						return {
							step: state.step,
							title: visible ? (state.linkedBoard?.title ?? '') : '',
							isVisible: visible,
							status: state.status,
						};
					}),
				});
			}
		}

		return result;
	}

	// The published learning paths the board is part of.
	public async findPublishedPaths(boardId: EntityId): Promise<ColumnBoard[]> {
		const steps = await this.boardNodeRepo.findLearningPathStepsLinking([boardId]);
		if (steps.length === 0) return [];

		const pathBoards = await this.boardNodeService.findByIds(Array.from(new Set(steps.map((step) => step.rootId))), 0);

		return pathBoards.filter(isColumnBoard).filter((pathBoard) => pathBoard.isLearningPath() && pathBoard.isVisible);
	}

	// For each given board, a published learning path that locks it (to name it in the room).
	public async findLockingPaths(boardIds: EntityId[]): Promise<Map<EntityId, ColumnBoard>> {
		const result = new Map<EntityId, ColumnBoard>();
		const steps = (await this.boardNodeRepo.findLearningPathStepsLinking(boardIds)).filter(
			(step) => step.lockUntilPrerequisitesDone
		);
		if (steps.length === 0) {
			return result;
		}

		const pathBoards = await this.boardNodeService.findByIds(Array.from(new Set(steps.map((step) => step.rootId))), 0);
		const pathById = new Map(
			pathBoards
				.filter(isColumnBoard)
				.filter((pathBoard) => pathBoard.isLearningPath() && pathBoard.isVisible)
				.map((pathBoard) => [pathBoard.id, pathBoard])
		);
		for (const step of steps) {
			const pathBoard = pathById.get(step.rootId);
			if (pathBoard && !result.has(step.linkedBoardId)) {
				result.set(step.linkedBoardId, pathBoard);
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

	private isLockedFor(
		boardId: EntityId,
		stepsPerPath: LearningPathStep[][],
		linkedBoards: Map<EntityId, ColumnBoard>,
		completed: Map<EntityId, Set<EntityId>>,
		userId: EntityId
	): boolean {
		let linked = false;
		for (const steps of stepsPerPath) {
			const states = this.computeStates(steps, linkedBoards, completed, userId).filter(
				(state) => state.step.linkedBoardId === boardId
			);
			if (states.length === 0) continue;
			linked = true;
			if (states.some((state) => state.status !== 'locked')) {
				return false;
			}
		}
		return linked;
	}

	private prerequisitesMet(step: LearningPathStep, isSatisfied: (stepId: EntityId) => boolean): boolean {
		const prerequisites = step.prerequisiteStepIds;
		if (prerequisites.length === 0) {
			return true;
		}
		return step.unlockMode === 'any' ? prerequisites.some(isSatisfied) : prerequisites.every(isSatisfied);
	}
}
