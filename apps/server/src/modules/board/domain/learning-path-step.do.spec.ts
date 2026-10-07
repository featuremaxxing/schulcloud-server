import { learningPathStepFactory } from '../testing';
import { orderedSteps, wouldCreateBoardCycle, wouldCreateCycle } from './learning-path-step.do';

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

	it('should be completed as its card, or else as its board', () => {
		const boardStep = learningPathStepFactory.build({ linkedBoardId: 'board-a' });
		const cardStep = learningPathStepFactory.build({ linkedBoardId: 'board-a', linkedCardId: 'card-1' });

		expect(boardStep.targetId).toBe('board-a');
		expect(cardStep.targetId).toBe('card-1');
	});

	it('should be a text tile when it links no board, completed as itself', () => {
		const text = learningPathStepFactory.build({ linkedBoardId: undefined, title: 'Teil 2', text: 'Los geht es' });

		expect(text.isText).toBe(true);
		expect(text.linkedBoardId).toBe('');
		expect(text.targetId).toBe(text.id);
		expect([text.title, text.text]).toEqual(['Teil 2', 'Los geht es']);
		expect(learningPathStepFactory.build().isText).toBe(false);
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

	describe('wouldCreateBoardCycle with cards', () => {
		it('should follow the arrows from card to card, not from board to board', () => {
			// blue: K1 -> K2, green: K2 -> K1 would be a circle; two cards of the same board are not
			const blue1 = learningPathStepFactory.build({ linkedBoardId: 'board-a', linkedCardId: 'card-1' });
			const blue2 = learningPathStepFactory.build({
				linkedBoardId: 'board-a',
				linkedCardId: 'card-2',
				prerequisiteStepIds: [blue1.id],
			});
			const green1 = learningPathStepFactory.build({ linkedBoardId: 'board-a', linkedCardId: 'card-1' });
			const green2 = learningPathStepFactory.build({ linkedBoardId: 'board-a', linkedCardId: 'card-2' });
			const steps = [blue1, blue2, green1, green2];

			expect(wouldCreateBoardCycle(steps, green1.id, [green2.id])).toBe(true);
			expect(wouldCreateBoardCycle(steps, green2.id, [green1.id])).toBe(false);
		});
	});

	describe('orderedSteps', () => {
		it('should put each step after its prerequisites, otherwise top to bottom', () => {
			const a = learningPathStepFactory.build({ positionY: 200 });
			const b = learningPathStepFactory.build({ positionY: 0, prerequisiteStepIds: [a.id] });
			const c = learningPathStepFactory.build({ positionY: 100 });

			expect(orderedSteps([a, b, c]).map((step) => step.id)).toEqual([c.id, a.id, b.id]);
		});
	});
});
