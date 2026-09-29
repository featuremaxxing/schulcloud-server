import { ObjectId } from '@mikro-orm/mongodb';
import { AssignmentStatus } from './assignment-status.enum';
import { assignmentFeedbackFactory, assignmentSubmissionFactory } from '../testing';
import { AssignmentSubmission, isAssignmentSubmission } from './assignment-submission.do';

describe(AssignmentSubmission.name, () => {
	it('should be instance of AssignmentSubmission', () => {
		const submission = assignmentSubmissionFactory.build();

		expect(isAssignmentSubmission(submission)).toBe(true);
	});

	it('should not be instance of AssignmentSubmission', () => {
		expect(isAssignmentSubmission({})).toBe(false);
	});

	it('should allow an AssignmentFeedback as a child', () => {
		const submission = assignmentSubmissionFactory.build();
		const feedback = assignmentFeedbackFactory.build();

		expect(submission.canHaveChild(feedback)).toBe(true);
	});

	it('should not allow any other node type as a child', () => {
		const submission = assignmentSubmissionFactory.build();
		const otherSubmission = assignmentSubmissionFactory.build();

		expect(submission.canHaveChild(otherSubmission)).toBe(false);
	});

	describe('getStatus', () => {
		it('should be OPEN when nothing has happened yet', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: undefined,
				points: undefined,
				feedbackComment: undefined,
				returnedAt: undefined,
			});

			expect(submission.getStatus()).toBe(AssignmentStatus.OPEN);
		});

		it('should be SUBMITTED once submittedAt is set', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: undefined,
				feedbackComment: undefined,
				returnedAt: undefined,
			});

			expect(submission.getStatus()).toBe(AssignmentStatus.SUBMITTED);
		});

		it('should be IN_REVIEW once the teacher has saved points, even without a comment', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: 5,
				feedbackComment: undefined,
				returnedAt: undefined,
			});

			expect(submission.getStatus()).toBe(AssignmentStatus.IN_REVIEW);
		});

		it('should be IN_REVIEW once the teacher has saved a comment, even without points', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: undefined,
				feedbackComment: 'well done',
				returnedAt: undefined,
			});

			expect(submission.getStatus()).toBe(AssignmentStatus.IN_REVIEW);
		});

		it('should be RETURNED once returnedAt is set, regardless of grading fields', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: undefined,
				feedbackComment: undefined,
				returnedAt: new Date(),
			});

			expect(submission.getStatus()).toBe(AssignmentStatus.RETURNED);
		});
	});

	it('should keep isLate as a snapshot independent of later changes to the submission', () => {
		const submission = assignmentSubmissionFactory.build({ isLate: true });

		expect(submission.isLate).toBe(true);

		submission.isLate = false;

		expect(submission.isLate).toBe(false);
	});

	it('should default isLate to false when unset', () => {
		const submission = assignmentSubmissionFactory.build({ isLate: undefined });

		expect(submission.isLate).toBe(false);
	});

	it('should get and set gradedBy', () => {
		const teacherId = new ObjectId().toHexString();
		const submission = assignmentSubmissionFactory.build({ gradedBy: undefined });

		submission.gradedBy = teacherId;

		expect(submission.gradedBy).toBe(teacherId);
	});
});
