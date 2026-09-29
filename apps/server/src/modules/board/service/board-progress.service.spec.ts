import { createMock } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { RoleName } from '@modules/role';
import {
	assignmentElementFactory,
	assignmentSubmissionFactory,
	cardFactory,
	checkboxElementFactory,
	columnBoardFactory,
} from '../testing';
import { BoardNodeAuthorizable, BoardNodeType, BoardRoles, PollAudience, type UserWithBoardRoles } from '../domain';
import { type BoardNodeRepo } from '../repo/board-node.repo';
import { type BoardNodeService } from './board-node.service';
import { BoardProgressService, type BoardWithAuth } from './board-progress.service';

describe('BoardProgressService', () => {
	const teacherId = new ObjectId().toHexString();
	const studentId = new ObjectId().toHexString();
	const otherStudentId = new ObjectId().toHexString();
	const boardId = new ObjectId().toHexString();
	const columnId = new ObjectId().toHexString();
	const cardId = new ObjectId().toHexString();
	const elementPath = `,${boardId},${columnId},${cardId},`;

	const teacherMember: UserWithBoardRoles = {
		userId: teacherId,
		roles: [BoardRoles.EDITOR],
		firstName: 'Tina',
		lastName: 'Teacher',
		schoolRoleNames: [RoleName.TEACHER],
	};
	const studentMember: UserWithBoardRoles = {
		userId: studentId,
		roles: [BoardRoles.READER],
		firstName: 'Sam',
		lastName: 'Student',
		schoolRoleNames: [RoleName.STUDENT],
	};
	const otherStudentMember: UserWithBoardRoles = {
		userId: otherStudentId,
		roles: [BoardRoles.READER],
		firstName: 'Otto',
		lastName: 'Other',
		schoolRoleNames: [RoleName.STUDENT],
	};

	const boardNodeRepo = createMock<BoardNodeRepo>();
	const boardNodeService = createMock<BoardNodeService>();
	const service = new BoardProgressService(boardNodeRepo, boardNodeService);

	const buildBoardWithAuth = (isTeacherView: boolean): BoardWithAuth => {
		const board = columnBoardFactory.build({ id: boardId, title: 'Board 1' });
		const auth = new BoardNodeAuthorizable({
			id: boardId,
			boardNode: board,
			rootNode: board,
			users: [teacherMember, studentMember, otherStudentMember],
			boardConfiguration: {},
		});
		return { board, auth, isTeacherView };
	};

	beforeEach(() => {
		jest.clearAllMocks();
		boardNodeService.findByIds.mockResolvedValue([cardFactory.build({ id: cardId, title: 'My Card' })]);
		boardNodeRepo.findPollVotesByParentIds.mockResolvedValue([]);
	});

	it('returns an empty result when no element types are enabled', async () => {
		const boards = [buildBoardWithAuth(false)];

		const result = await service.computeBoardsProgress(studentId, boards, []);

		expect(result).toEqual([
			{ boardId, boardTitle: 'Board 1', isTeacherView: false, summary: { done: 0, total: 0 }, items: [] },
		]);
		expect(boardNodeRepo.findElementsByBoardIds).not.toHaveBeenCalled();
	});

	it('builds a student summary counting items, not eligible users', async () => {
		const checkbox = checkboxElementFactory.build({
			path: elementPath,
			creatorId: teacherId,
			entries: [{ userId: studentId, checked: true, approved: false }],
		});
		boardNodeRepo.findElementsByBoardIds.mockResolvedValue([checkbox]);
		boardNodeRepo.findAssignmentSubmissionsByParentIds.mockResolvedValue([]);
		const boards = [buildBoardWithAuth(false)];

		const [result] = await service.computeBoardsProgress(studentId, boards, [BoardNodeType.CHECKBOX_ELEMENT]);

		expect(result.summary).toEqual({ done: 1, total: 1 });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			type: 'checkbox',
			elementId: checkbox.id,
			cardId,
			cardTitle: 'My Card',
			done: true,
			eligible: true,
			doneCount: 1,
			eligibleCount: 2,
		});
		expect(result.items[0].students).toBeUndefined();
	});

	it('builds a teacher summary counting eligible-student × item pairs, with student breakdown on request', async () => {
		const checkbox = checkboxElementFactory.build({
			path: elementPath,
			creatorId: teacherId,
			entries: [{ userId: studentId, checked: true, approved: false }],
		});
		boardNodeRepo.findElementsByBoardIds.mockResolvedValue([checkbox]);
		boardNodeRepo.findAssignmentSubmissionsByParentIds.mockResolvedValue([]);
		const boards = [buildBoardWithAuth(true)];

		const [result] = await service.computeBoardsProgress(teacherId, boards, [BoardNodeType.CHECKBOX_ELEMENT], {
			includeStudents: true,
		});

		expect(result.summary).toEqual({ done: 1, total: 2 });
		expect(result.items[0].students).toEqual(
			expect.arrayContaining([
				{ userId: studentId, firstName: 'Sam', lastName: 'Student', done: true },
				{ userId: otherStudentId, firstName: 'Otto', lastName: 'Other', done: false },
			])
		);
	});

	it('drops an item with no eligible members', async () => {
		const checkbox = checkboxElementFactory.build({ path: elementPath, creatorId: teacherId });
		boardNodeRepo.findElementsByBoardIds.mockResolvedValue([checkbox]);
		boardNodeRepo.findAssignmentSubmissionsByParentIds.mockResolvedValue([]);
		// audience TEACHERS but the only teacher is the creator, who is always excluded
		checkbox.audience = PollAudience.TEACHERS;
		const boards = [buildBoardWithAuth(true)];

		const [result] = await service.computeBoardsProgress(teacherId, boards, [BoardNodeType.CHECKBOX_ELEMENT]);

		expect(result.items).toHaveLength(0);
		expect(result.summary).toEqual({ done: 0, total: 0 });
	});

	it('hides an assignment from a student before its start date', async () => {
		const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const assignment = assignmentElementFactory.build({ path: elementPath, startDate: futureStart });
		boardNodeRepo.findElementsByBoardIds.mockResolvedValue([assignment]);
		boardNodeRepo.findAssignmentSubmissionsByParentIds.mockResolvedValue([]);
		const boards = [buildBoardWithAuth(false)];

		const [result] = await service.computeBoardsProgress(studentId, boards, [BoardNodeType.ASSIGNMENT_ELEMENT]);

		expect(result.items).toHaveLength(0);
	});

	it('still counts an assignment for the teacher before its start date', async () => {
		const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const assignment = assignmentElementFactory.build({ path: elementPath, startDate: futureStart });
		boardNodeRepo.findElementsByBoardIds.mockResolvedValue([assignment]);
		boardNodeRepo.findAssignmentSubmissionsByParentIds.mockResolvedValue([]);
		const boards = [buildBoardWithAuth(true)];

		const [result] = await service.computeBoardsProgress(teacherId, boards, [BoardNodeType.ASSIGNMENT_ELEMENT]);

		expect(result.items).toHaveLength(1);
	});

	it('counts a submitted assignment as done', async () => {
		const assignment = assignmentElementFactory.build({ path: elementPath });
		const submission = assignmentSubmissionFactory.build({
			path: `${elementPath}${assignment.id},`,
			userId: studentId,
			submittedAt: new Date(),
		});
		boardNodeRepo.findElementsByBoardIds.mockResolvedValue([assignment]);
		boardNodeRepo.findAssignmentSubmissionsByParentIds.mockResolvedValue([submission]);
		const boards = [buildBoardWithAuth(false)];

		const [result] = await service.computeBoardsProgress(studentId, boards, [BoardNodeType.ASSIGNMENT_ELEMENT]);

		expect(result.items[0]).toMatchObject({ done: true, eligible: true });
	});
});
