import { assignmentElementFactory, assignmentSubmissionFactory } from '../testing';
import { AssignmentElement, isAssignmentElement } from './assignment-element.do';

describe(AssignmentElement.name, () => {
	it('should be instance of AssignmentElement', () => {
		const element = assignmentElementFactory.build();

		expect(isAssignmentElement(element)).toBe(true);
	});

	it('should not be instance of AssignmentElement', () => {
		expect(isAssignmentElement({})).toBe(false);
	});

	it('should only allow AssignmentSubmission as child', () => {
		const element = assignmentElementFactory.build();
		const submission = assignmentSubmissionFactory.build();

		expect(element.canHaveChild(submission)).toBe(true);
	});

	it('should not allow a non-submission child', () => {
		const element = assignmentElementFactory.build();
		const other = assignmentElementFactory.build();

		expect(element.canHaveChild(other)).toBe(false);
	});

	describe('lateUntil', () => {
		it('should be undefined when there is no dueDate', () => {
			const element = assignmentElementFactory.build({ dueDate: undefined });

			expect(element.lateUntil).toBeUndefined();
		});

		it('should equal dueDate when there is no grace period', () => {
			const dueDate = new Date('2026-01-10T10:00:00.000Z');
			const element = assignmentElementFactory.build({ dueDate, graceMinutes: undefined });

			expect(element.lateUntil).toEqual(dueDate);
		});

		it('should be dueDate plus graceMinutes', () => {
			const dueDate = new Date('2026-01-10T10:00:00.000Z');
			const element = assignmentElementFactory.build({ dueDate, graceMinutes: 60 });

			expect(element.lateUntil).toEqual(new Date('2026-01-10T11:00:00.000Z'));
		});

		it('should move when dueDate is changed later, without needing graceMinutes to be re-set', () => {
			const element = assignmentElementFactory.build({
				dueDate: new Date('2026-01-10T10:00:00.000Z'),
				graceMinutes: 60,
			});

			element.dueDate = new Date('2026-02-01T10:00:00.000Z');

			expect(element.lateUntil).toEqual(new Date('2026-02-01T11:00:00.000Z'));
		});
	});

	describe('isSubmittable', () => {
		it('should be true when there is no dueDate at all', () => {
			const element = assignmentElementFactory.build({ dueDate: undefined });

			expect(element.isSubmittable(new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
		});

		it('should be true before dueDate', () => {
			const element = assignmentElementFactory.build({ dueDate: new Date('2026-01-10T10:00:00.000Z') });

			expect(element.isSubmittable(new Date('2026-01-10T09:59:59.000Z'))).toBe(true);
		});

		it('should still be true within the grace period after dueDate', () => {
			const element = assignmentElementFactory.build({
				dueDate: new Date('2026-01-10T10:00:00.000Z'),
				graceMinutes: 60,
			});

			expect(element.isSubmittable(new Date('2026-01-10T10:59:00.000Z'))).toBe(true);
		});

		it('should be false after the grace period', () => {
			const element = assignmentElementFactory.build({
				dueDate: new Date('2026-01-10T10:00:00.000Z'),
				graceMinutes: 60,
			});

			expect(element.isSubmittable(new Date('2026-01-10T11:00:01.000Z'))).toBe(false);
		});

		it('should be false before the startDate, even without a dueDate', () => {
			const element = assignmentElementFactory.build({
				startDate: new Date('2026-01-10T10:00:00.000Z'),
				dueDate: undefined,
			});

			expect(element.isSubmittable(new Date('2026-01-10T09:59:59.000Z'))).toBe(false);
		});

		it('should be true from the startDate onward', () => {
			const element = assignmentElementFactory.build({
				startDate: new Date('2026-01-10T10:00:00.000Z'),
				dueDate: undefined,
			});

			expect(element.isSubmittable(new Date('2026-01-10T10:00:00.000Z'))).toBe(true);
		});
	});

	describe('isStartedAt', () => {
		it('should be true when there is no startDate at all', () => {
			const element = assignmentElementFactory.build({ startDate: undefined });

			expect(element.isStartedAt(new Date('2020-01-01T00:00:00.000Z'))).toBe(true);
		});

		it('should be false before startDate', () => {
			const element = assignmentElementFactory.build({ startDate: new Date('2026-01-10T10:00:00.000Z') });

			expect(element.isStartedAt(new Date('2026-01-10T09:59:59.000Z'))).toBe(false);
		});

		it('should be true exactly at and after startDate', () => {
			const element = assignmentElementFactory.build({ startDate: new Date('2026-01-10T10:00:00.000Z') });

			expect(element.isStartedAt(new Date('2026-01-10T10:00:00.000Z'))).toBe(true);
			expect(element.isStartedAt(new Date('2026-01-10T10:00:01.000Z'))).toBe(true);
		});
	});

	describe('isLateAt', () => {
		it('should be false without a dueDate', () => {
			const element = assignmentElementFactory.build({ dueDate: undefined });

			expect(element.isLateAt(new Date('2099-01-01T00:00:00.000Z'))).toBe(false);
		});

		it('should be false exactly at dueDate', () => {
			const dueDate = new Date('2026-01-10T10:00:00.000Z');
			const element = assignmentElementFactory.build({ dueDate });

			expect(element.isLateAt(dueDate)).toBe(false);
		});

		it('should be true after dueDate, even within the grace period', () => {
			const element = assignmentElementFactory.build({
				dueDate: new Date('2026-01-10T10:00:00.000Z'),
				graceMinutes: 60,
			});

			expect(element.isLateAt(new Date('2026-01-10T10:30:00.000Z'))).toBe(true);
		});
	});
});
