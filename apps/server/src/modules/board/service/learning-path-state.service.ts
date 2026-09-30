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
	public async lockedUserIds(
		boards: ColumnBoard[],
		users: UserWithBoardRoles[]
	): Promise<Map<EntityId, EntityId[]>> {
		const result = new Map<EntityId, EntityId[]>();
		if (!this.config.featureBoardLearningPathEnabled) {
			return result;
		}

		const candidates = boards.filter((board) => board.hasColumns());
		const linkingSteps = await this.boardNodeRepo.findLearningPathStepsLinking(candidates.map((board) => board.id));
		if (!linkingSteps.some((step) => step.lockUntilPrerequisitesDone)) {
			return result;
		}

		const pathBoards = (await this.boardNodeService.findByIds(Array.from(new Set(linkingSteps.map((s) => s.rootId))), 1))
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

	// The published learning paths the board is part of.
	public async findPublishedPaths(boardId: EntityId): Promise<ColumnBoard[]> {
		const steps = await this.boardNodeRepo.findLearningPathStepsLinking([boardId]);
		if (steps.length === 0) return [];

		const pathBoards = await this.boardNodeService.findByIds(Array.from(new Set(steps.map((step) => step.rootId))), 0);

		return pathBoards
			.filter(isColumnBoard)
			.filter((pathBoard) => pathBoard.isLearningPath() && pathBoard.isVisible);
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
