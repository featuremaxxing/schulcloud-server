import { type EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { LearningPathStepProps, LearningPathUnlockMode } from './types';

// A tile on a learning path board (layout LEARNING_PATH). It links another board of the
// same room, or one card of such a board; arrows between tiles are stored as
// prerequisiteStepIds on the target tile.
export class LearningPathStep extends BoardNode<LearningPathStepProps> {
	get linkedBoardId(): EntityId {
		return this.props.linkedBoardId;
	}

	set linkedBoardId(value: EntityId) {
		this.props.linkedBoardId = value;
	}

	// set when the step is a single card; linkedBoardId is then the board the card lies on
	get linkedCardId(): EntityId | undefined {
		return this.props.linkedCardId;
	}

	set linkedCardId(value: EntityId | undefined) {
		this.props.linkedCardId = value;
	}

	// what has to be completed for the step: the card, or else the whole board
	get targetId(): EntityId {
		return this.props.linkedCardId ?? this.props.linkedBoardId;
	}

	get positionX(): number {
		return this.props.positionX ?? 0;
	}

	set positionX(value: number) {
		this.props.positionX = value;
	}

	get positionY(): number {
		return this.props.positionY ?? 0;
	}

	set positionY(value: number) {
		this.props.positionY = value;
	}

	get prerequisiteStepIds(): EntityId[] {
		return this.props.prerequisiteStepIds ?? [];
	}

	set prerequisiteStepIds(value: EntityId[]) {
		this.props.prerequisiteStepIds = Array.from(new Set(value)).filter((id) => id !== this.id);
	}

	get unlockMode(): LearningPathUnlockMode {
		return this.props.unlockMode ?? 'all';
	}

	set unlockMode(value: LearningPathUnlockMode) {
		this.props.unlockMode = value;
	}

	get lockUntilPrerequisitesDone(): boolean {
		return this.props.lockUntilPrerequisitesDone ?? false;
	}

	set lockUntilPrerequisitesDone(value: boolean) {
		this.props.lockUntilPrerequisitesDone = value;
	}

	public removePrerequisite(stepId: EntityId): void {
		this.props.prerequisiteStepIds = this.prerequisiteStepIds.filter((id) => id !== stepId);
	}

	public canHaveChild(): boolean {
		return false;
	}
}

export const isLearningPathStep = (reference: unknown): reference is LearningPathStep =>
	reference instanceof LearningPathStep;

// true when adding the given prerequisites to the step would close a cycle
export const wouldCreateCycle = (
	steps: LearningPathStep[],
	stepId: EntityId,
	prerequisiteStepIds: EntityId[]
): boolean => {
	const prerequisitesOf = new Map(steps.map((step) => [step.id, step.prerequisiteStepIds]));
	prerequisitesOf.set(stepId, prerequisiteStepIds);

	const visited = new Set<EntityId>();
	const stack = [...prerequisiteStepIds];
	while (stack.length > 0) {
		const current = stack.pop() as EntityId;
		if (current === stepId) return true;
		if (visited.has(current)) continue;
		visited.add(current);
		stack.push(...(prerequisitesOf.get(current) ?? []));
	}
	return false;
};

// Same, across every learning path of a room: a board or card must never come before itself,
// otherwise somebody going both paths could never get past it. The arrows are followed from
// target to target.
export const wouldCreateBoardCycle = (
	steps: LearningPathStep[],
	stepId: EntityId,
	prerequisiteStepIds: EntityId[]
): boolean => {
	const stepsById = new Map(steps.map((step) => [step.id, step]));
	const target = stepsById.get(stepId);
	if (!target) return false;

	const prerequisiteTargets = new Map<EntityId, Set<EntityId>>();
	for (const step of steps) {
		const targets = prerequisiteTargets.get(step.targetId) ?? new Set<EntityId>();
		const ids = step.id === stepId ? prerequisiteStepIds : step.prerequisiteStepIds;
		ids.forEach((id) => {
			const targetId = stepsById.get(id)?.targetId;
			if (targetId) targets.add(targetId);
		});
		prerequisiteTargets.set(step.targetId, targets);
	}

	const visited = new Set<EntityId>();
	const stack = Array.from(prerequisiteTargets.get(target.targetId) ?? []);
	while (stack.length > 0) {
		const current = stack.pop() as EntityId;
		if (current === target.targetId) return true;
		if (visited.has(current)) continue;
		visited.add(current);
		stack.push(...Array.from(prerequisiteTargets.get(current) ?? []));
	}
	return false;
};

// The steps in reading order: each one after its prerequisites, otherwise top to bottom and left
// to right (as the client shows the chain).
export const orderedSteps = (steps: LearningPathStep[]): LearningPathStep[] => {
	const byPosition = [...steps].sort((a, b) => a.positionY - b.positionY || a.positionX - b.positionX);
	const ids = new Set(steps.map((step) => step.id));
	const placed = new Set<EntityId>();
	const result: LearningPathStep[] = [];

	while (result.length < byPosition.length) {
		const next =
			byPosition.find(
				(step) => !placed.has(step.id) && step.prerequisiteStepIds.every((id) => !ids.has(id) || placed.has(id))
			) ?? byPosition.find((step) => !placed.has(step.id));
		if (!next) break;
		placed.add(next.id);
		result.push(next);
	}

	return result;
};

export const LEARNING_PATH_MAX_STEPS = 100;
