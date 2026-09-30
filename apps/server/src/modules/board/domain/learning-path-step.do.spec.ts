import { learningPathStepFactory } from '../testing';
import { wouldCreateCycle } from './learning-path-step.do';

describe('LearningPathStep', () => {
	it('should not have children', () => {
		const step = learningPathStepFactory.build();

		expect(step.canHaveChild()).toBe(false);
	});

	it('should drop duplicates and itself from the prerequisites', () => {
		const step = learningPathStepFactory.build();
		const other = learningPathStepFactory.build();

		step.prerequisiteStepIds = [other.id, other.id, step.id];

		expect(step.prerequisiteStepIds).toEqual([other.id]);
	});

	it('should remove a prerequisite', () => {
		const a = learningPathStepFactory.build();
		const b = learningPathStepFactory.build();
		const step = learningPathStepFactory.build({ prerequisiteStepIds: [a.id, b.id] });

		step.removePrerequisite(a.id);

		expect(step.prerequisiteStepIds).toEqual([b.id]);
	});

	describe('wouldCreateCycle', () => {
		const setup = () => {
			const a = learningPathStepFactory.build();
			const b = learningPathStepFactory.build({ prerequisiteStepIds: [a.id] });
			const c = learningPathStepFactory.build({ prerequisiteStepIds: [b.id] });

			return { a, b, c, steps: [a, b, c] };
		};

		it('should detect a circle through several steps', () => {
			const { a, c, steps } = setup();

			expect(wouldCreateCycle(steps, a.id, [c.id])).toBe(true);
		});

		it('should allow a branch that joins again', () => {
			const { a, b, c, steps } = setup();

			expect(wouldCreateCycle(steps, c.id, [b.id, a.id])).toBe(false);
		});
	});
});
