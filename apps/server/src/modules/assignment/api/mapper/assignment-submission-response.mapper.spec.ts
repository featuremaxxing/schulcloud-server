import { ObjectId } from '@mikro-orm/mongodb';
import { FileDto, FileRecordParentType } from '@infra/files-storage-amqp-client';
import { assignmentElementFactory, assignmentSubmissionFactory } from '@modules/board/testing';
import { AssignmentSubmissionResponseMapper } from './assignment-submission-response.mapper';
import { type AssignmentSubmissionEntry, type AssignmentSubmissionsListResult } from '../assignment.uc';

describe(AssignmentSubmissionResponseMapper.name, () => {
	const buildEntry = (overrides: Partial<AssignmentSubmissionEntry> = {}): AssignmentSubmissionEntry => {
		const userId = new ObjectId().toHexString();

		return { userId, ...overrides };
	};

	const buildFeedbackFiles = (): FileDto[] => [
		new FileDto({
			id: new ObjectId().toHexString(),
			name: 'feedback-pdf-2.pdf',
			parentType: FileRecordParentType.BoardNode,
			parentId: new ObjectId().toHexString(),
			createdAt: new Date('2026-01-02'),
		}),
		new FileDto({
			id: new ObjectId().toHexString(),
			name: 'feedback-img-1.png',
			parentType: FileRecordParentType.BoardNode,
			parentId: new ObjectId().toHexString(),
			createdAt: new Date('2026-01-01'),
		}),
	];

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

		it('should withhold feedback files before the submission has been returned', () => {
			const submission = assignmentSubmissionFactory.build({ returnedAt: undefined });
			const entry = buildEntry({ submission, feedbackFiles: buildFeedbackFiles() });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.feedbackFiles).toBeNull();
		});

		it('should reveal feedback files once the submission has been returned, keeping the order', () => {
			const submission = assignmentSubmissionFactory.build({ returnedAt: new Date() });
			const entry = buildEntry({ submission, feedbackFiles: buildFeedbackFiles() });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.feedbackFiles?.map((file) => file.name)).toEqual(['feedback-pdf-2.pdf', 'feedback-img-1.png']);
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

		it('should reveal fileVersions even before the submission has been returned, numbered oldest to newest', () => {
			const submission = assignmentSubmissionFactory.build({ returnedAt: undefined });
			const entry = buildEntry({ submission, fileVersions: buildFeedbackFiles() });

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.fileVersions?.map((file) => [file.name, file.version])).toEqual([
				['feedback-pdf-2.pdf', 2],
				['feedback-img-1.png', 1],
			]);
		});

		it('should never include which teacher graded the submission', () => {
			const entry = buildEntry({
				gradedBy: { userId: new ObjectId().toHexString(), firstName: 'Ada', lastName: 'Lovelace' },
			});

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.gradedByFirstName).toBeUndefined();
			expect(response.gradedByLastName).toBeUndefined();
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

		it('should include feedback files immediately, before any return', () => {
			const submission = assignmentSubmissionFactory.build({ returnedAt: undefined });
			const entry = buildEntry({ submission, feedbackFiles: buildFeedbackFiles() });

			const response = AssignmentSubmissionResponseMapper.mapForTeacher(entry);

			expect(response.feedbackFiles).toHaveLength(2);
		});

		it('should include the grading teacher name when the entry carries one', () => {
			const entry = buildEntry({
				gradedBy: { userId: new ObjectId().toHexString(), firstName: 'Ada', lastName: 'Lovelace' },
			});

			const response = AssignmentSubmissionResponseMapper.mapForTeacher(entry);

			expect(response.gradedByFirstName).toBe('Ada');
			expect(response.gradedByLastName).toBe('Lovelace');
		});

		it('should leave the grading teacher name unset when the entry has none', () => {
			const entry = buildEntry({});

			const response = AssignmentSubmissionResponseMapper.mapForTeacher(entry);

			expect(response.gradedByFirstName).toBeUndefined();
			expect(response.gradedByLastName).toBeUndefined();
		});
	});

	describe('fileVersions', () => {
		it('should return null when there are no versions', () => {
			const entry = buildEntry({});

			const response = AssignmentSubmissionResponseMapper.mapForOwner(entry);

			expect(response.fileVersions).toBeNull();
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
