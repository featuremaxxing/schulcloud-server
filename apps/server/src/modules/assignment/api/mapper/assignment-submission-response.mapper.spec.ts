import { ObjectId } from '@mikro-orm/mongodb';
import { assignmentElementFactory, assignmentSubmissionFactory } from '@modules/board/testing';
import { AssignmentSubmissionResponseMapper } from './assignment-submission-response.mapper';
import { type AssignmentSubmissionEntry, type AssignmentSubmissionsListResult } from '../assignment.uc';

describe(AssignmentSubmissionResponseMapper.name, () => {
	const buildEntry = (overrides: Partial<AssignmentSubmissionEntry> = {}): AssignmentSubmissionEntry => {
		const userId = new ObjectId().toHexString();

		return { userId, ...overrides };
	};

	describe('mapForOwner', () => {
		it('should withhold points and feedbackComment before the submission has been returned', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: 8,
				feedbackComment: 'nicely done',
				returnedAt: undefined,
			});
			const entry = buildEntry({ submission });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.points).toBeNull();
			expect(response.feedbackComment).toBeNull();
		});

		it('should reveal points and feedbackComment once the submission has been returned', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: 8,
				feedbackComment: 'nicely done',
				returnedAt: new Date(),
			});
			const entry = buildEntry({ submission });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.points).toBe(8);
			expect(response.feedbackComment).toBe('nicely done');
		});

		it('should never include firstName/lastName, even if the entry carries them', () => {
			const entry = buildEntry({ firstName: 'Marie', lastName: 'Curie' });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.firstName).toBeUndefined();
			expect(response.lastName).toBeUndefined();
		});

		it('should represent a not-yet-created submission as a null id with status OPEN', () => {
			const entry = buildEntry({ submission: undefined });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.id).toBeNull();
			expect(response.status).toBe('open');
		});
	});

	describe('mapForTeacher', () => {
		it('should include points and feedbackComment even before the submission has been returned', () => {
			const submission = assignmentSubmissionFactory.build({
				submittedAt: new Date(),
				points: 8,
				feedbackComment: 'nicely done',
				returnedAt: undefined,
			});
			const entry = buildEntry({ submission, firstName: 'Marie', lastName: 'Curie' });

			const response = AssignmentSubmissionResponseMapper.mapForTeacher(entry);

			expect(response.points).toBe(8);
			expect(response.feedbackComment).toBe('nicely done');
			expect(response.firstName).toBe('Marie');
			expect(response.lastName).toBe('Curie');
		});
	});

	describe('mapList', () => {
		it('should route every entry through mapForOwner when the viewer is a student', () => {
			const element = assignmentElementFactory.build({ maxPoints: 10 });
			const submission = assignmentSubmissionFactory.build({
				points: 8,
				feedbackComment: 'nicely done',
				returnedAt: undefined,
			});
			const result: AssignmentSubmissionsListResult = {
				element,
				isTeacher: false,
				entries: [buildEntry({ submission })],
			};

			const response = AssignmentSubmissionResponseMapper.mapList(result);

			expect(response.submissions).toHaveLength(1);
			expect(response.submissions[0].points).toBeNull();
		});

		it('should route every entry through mapForTeacher when the viewer is a teacher', () => {
			const element = assignmentElementFactory.build({ maxPoints: 10 });
			const submission = assignmentSubmissionFactory.build({
				points: 8,
				feedbackComment: 'nicely done',
				returnedAt: undefined,
			});
			const result: AssignmentSubmissionsListResult = {
				element,
				isTeacher: true,
				entries: [buildEntry({ submission })],
			};

			const response = AssignmentSubmissionResponseMapper.mapList(result);

			expect(response.submissions[0].points).toBe(8);
		});
	});
});
