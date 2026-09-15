import { assignmentElementFactory, assignmentSubmissionFactory } from '@modules/board/testing';
import { AssignmentListResponseMapper } from './assignment-list-response.mapper';

describe(AssignmentListResponseMapper.name, () => {
	describe('mapList', () => {
		const setup = () => {
			const element = assignmentElementFactory.build({
				title: 'Homework 1',
				startDate: new Date('2099-01-10T09:00:00.000Z'),
				dueDate: new Date('2099-01-20T10:00:00.000Z'),
				graceMinutes: 60,
				maxPoints: 10,
			});
			const submissionOfStudentA = assignmentSubmissionFactory.build({ userId: 'student-a' });
			const submissionOfStudentB = assignmentSubmissionFactory.build({ userId: 'student-b' });

			return { element, submissionOfStudentA, submissionOfStudentB };
		};

		it('should map an assignment for a teacher with submission counts', () => {
			const { element, submissionOfStudentA, submissionOfStudentB } = setup();

			const result = AssignmentListResponseMapper.mapList([
				{
					element,
					roomId: 'room-1',
					boardId: 'board-1',
					isTeacher: true,
					submissions: [submissionOfStudentA, submissionOfStudentB],
				},
			]);

			expect(result.assignments).toHaveLength(1);
			const item = result.assignments[0];
			expect(item.id).toEqual(element.id);
			expect(item.roomId).toEqual('room-1');
			expect(item.boardId).toEqual('board-1');
			expect(item.title).toEqual('Homework 1');
			expect(item.startDate).toEqual('2099-01-10T09:00:00.000Z');
			expect(item.dueDate).toEqual('2099-01-20T10:00:00.000Z');
			expect(item.lateUntil).toEqual('2099-01-20T11:00:00.000Z');
			expect(item.isStarted).toBe(false);
			expect(item.isSubmittable).toBe(false);
			expect(item.maxPoints).toEqual(10);
			expect(item.submissionsTotal).toEqual(2);
			expect(item.submissionsSubmitted).toEqual(0);
			expect(item.ownSubmissionStatus).toBeNull();
			expect(item.ownSubmissionIsLate).toBeNull();
		});

		it('should mark a started and submittable assignment', () => {
			const { element } = setup();
			element.startDate = new Date('2020-01-10T09:00:00.000Z');

			const result = AssignmentListResponseMapper.mapList([
				{ element, roomId: 'room-1', boardId: 'board-1', isTeacher: false, submissions: [] },
			]);

			const item = result.assignments[0];
			expect(item.isStarted).toBe(true);
			expect(item.isSubmittable).toBe(true);
		});

		it('should count only handed-in submissions as submitted', () => {
			const { element } = setup();
			const open = assignmentSubmissionFactory.build({ userId: 'student-a' });
			const submitted = assignmentSubmissionFactory.build({ userId: 'student-b', submittedAt: new Date() });

			const result = AssignmentListResponseMapper.mapList([
				{ element, roomId: 'room-1', boardId: 'board-1', isTeacher: true, submissions: [open, submitted] },
			]);

			expect(result.assignments[0].submissionsTotal).toEqual(2);
			expect(result.assignments[0].submissionsSubmitted).toEqual(1);
		});

		it('should map an assignment for a student with their own submission status only', () => {
			const { element } = setup();
			const ownSubmission = assignmentSubmissionFactory.build({
				userId: 'student-a',
				submittedAt: new Date(),
				isLate: true,
			});

			const result = AssignmentListResponseMapper.mapList([
				{ element, roomId: 'room-1', boardId: 'board-1', isTeacher: false, submissions: [ownSubmission] },
			]);

			const item = result.assignments[0];
			expect(item.submissionsTotal).toBeNull();
			expect(item.submissionsSubmitted).toBeNull();
			expect(item.ownSubmissionStatus).toEqual('submitted');
			expect(item.ownSubmissionIsLate).toBe(true);
		});

		it('should map a student assignment without any submission of their own', () => {
			const { element } = setup();

			const result = AssignmentListResponseMapper.mapList([
				{ element, roomId: 'room-1', boardId: 'board-1', isTeacher: false, submissions: [] },
			]);

			const item = result.assignments[0];
			expect(item.ownSubmissionStatus).toBeNull();
			expect(item.ownSubmissionIsLate).toBeNull();
		});

		it('should mark a not-yet-started assignment', () => {
			const { element } = setup();
			element.startDate = new Date('2099-01-01T00:00:00.000Z');

			const result = AssignmentListResponseMapper.mapList([
				{ element, roomId: 'room-1', boardId: 'board-1', isTeacher: false, submissions: [] },
			]);

			const item = result.assignments[0];
			expect(item.isStarted).toBe(false);
			expect(item.isSubmittable).toBe(false);
		});
	});
});
