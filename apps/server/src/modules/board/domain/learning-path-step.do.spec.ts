import { learningPathStepFactory } from '../testing';
import { wouldCreateBoardCycle, wouldCreateCycle } from './learning-path-step.do';

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

	describe('wouldCreateBoardCycle', () => {
		// blue: A -> C. green holds the same two boards.
		const setup = () => {
			const blueA = learningPathStepFactory.build({ linkedBoardId: 'board-a' });
			const blueC = learningPathStepFactory.build({ linkedBoardId: 'board-c', prerequisiteStepIds: [blueA.id] });
			const greenA = learningPathStepFactory.build({ linkedBoardId: 'board-a' });
			const greenC = learningPathStepFactory.build({ linkedBoardId: 'board-c' });

			return { blueA, blueC, greenA, greenC, steps: [blueA, blueC, greenA, greenC] };
		};

		it('should detect a circle that only exists across two learning paths', () => {
			const { greenA, greenC, steps } = setup();

			expect(wouldCreateBoardCycle(steps, greenA.id, [greenC.id])).toBe(true);
		});

		it('should allow arrows that agree with the other learning path', () => {
			const { greenA, greenC, steps } = setup();

			expect(wouldCreateBoardCycle(steps, greenC.id, [greenA.id])).toBe(false);
		});

		it('should find the circle inside one learning path as well', () => {
			const { blueA, blueC, steps } = setup();

			expect(wouldCreateBoardCycle(steps, blueA.id, [blueC.id])).toBe(true);
		});
	});
});
