import { type EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { LearningPathStepProps, LearningPathUnlockMode } from './types';

// A tile on a learning path board (layout LEARNING_PATH). It links another board of the
// same room; arrows between tiles are stored as prerequisiteStepIds on the target tile.
export class LearningPathStep extends BoardNode<LearningPathStepProps> {
	get linkedBoardId(): EntityId {
		return this.props.linkedBoardId;
	}

	set linkedBoardId(value: EntityId) {
		this.props.linkedBoardId = value;
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

export const LEARNING_PATH_MAX_STEPS = 100;
