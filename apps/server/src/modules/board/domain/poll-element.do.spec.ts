import { pollElementFactory, pollVoteFactory } from '../testing';
import { isPollElement, PollElement } from './poll-element.do';
import { PollStatus } from './types';

describe(PollElement.name, () => {
	it('should be instance of PollElement', () => {
		const element = pollElementFactory.build();

		expect(isPollElement(element)).toBe(true);
	});

	it('should not be instance of PollElement', () => {
		expect(isPollElement({})).toBe(false);
	});

	it('should only allow PollVote as child', () => {
		const element = pollElementFactory.build();
		const vote = pollVoteFactory.build();

		expect(element.canHaveChild(vote)).toBe(true);
	});

	it('should not allow a non-vote child', () => {
		const element = pollElementFactory.build();
		const other = pollElementFactory.build();

		expect(element.canHaveChild(other)).toBe(false);
	});

	describe('isOpen', () => {
		it('should be false when pollStatus is draft', () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.DRAFT });

			expect(element.isOpen(new Date())).toBe(false);
		});

		it('should be false when pollStatus is closed', () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.CLOSED });

			expect(element.isOpen(new Date())).toBe(false);
		});

		it('should be true when pollStatus is open and there is no closesAt', () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.OPEN, closesAt: undefined });

			expect(element.isOpen(new Date())).toBe(true);
		});

		it('should be true when pollStatus is open and closesAt is in the future', () => {
			const now = new Date('2026-01-10T10:00:00.000Z');
			const element = pollElementFactory.build({
				pollStatus: PollStatus.OPEN,
				closesAt: new Date('2026-01-10T11:00:00.000Z'),
			});

			expect(element.isOpen(now)).toBe(true);
		});

		it('should be false when pollStatus is open but closesAt has passed', () => {
			const now = new Date('2026-01-10T12:00:00.000Z');
			const element = pollElementFactory.build({
				pollStatus: PollStatus.OPEN,
				closesAt: new Date('2026-01-10T11:00:00.000Z'),
			});

			expect(element.isOpen(now)).toBe(false);
		});

		it('should be false exactly at closesAt', () => {
			const closesAt = new Date('2026-01-10T11:00:00.000Z');
			const element = pollElementFactory.build({ pollStatus: PollStatus.OPEN, closesAt });

			expect(element.isOpen(closesAt)).toBe(false);
		});
	});
});
