import { createMock } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { type AuthorizationService } from '@modules/authorization';
import { ForbiddenException } from '@nestjs/common';
import { type BoardNodeRule } from '../authorisation/board-node.rule';
import { type BoardConfig } from '../board.config';
import { BoardNodeAuthorizable, BoardRoles } from '../domain';
import { type BoardNodeAuthorizableService, type BoardNodeService, type BoardProgressService } from '../service';
import { columnBoardFactory } from '../testing';
import { BoardProgressUc } from './board-progress.uc';

describe('BoardProgressUc', () => {
	const teacherId = new ObjectId().toHexString();
	const studentId = new ObjectId().toHexString();
	const board = columnBoardFactory.build({ title: 'Board 1' });
	const auth = new BoardNodeAuthorizable({
		id: board.id,
		boardNode: board,
		rootNode: board,
		users: [
			{ userId: teacherId, roles: [BoardRoles.EDITOR], schoolRoleNames: [] },
			{ userId: studentId, roles: [BoardRoles.READER], schoolRoleNames: [] },
		],
		boardConfiguration: {},
	});

	const authorizationService = createMock<AuthorizationService>();
	const boardNodeService = createMock<BoardNodeService>();
	const boardNodeAuthorizableService = createMock<BoardNodeAuthorizableService>();
	const boardNodeRule = createMock<BoardNodeRule>();
	const boardProgressService = createMock<BoardProgressService>();
	const buildUc = (config: Partial<BoardConfig>) =>
		new BoardProgressUc(
			authorizationService,
			boardNodeService,
			boardNodeAuthorizableService,
			boardNodeRule,
			boardProgressService,
			config as BoardConfig
		);

	beforeEach(() => {
		jest.clearAllMocks();
		boardNodeService.findByClassAndId.mockResolvedValue(board);
		boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue(auth);
		authorizationService.getUserWithPermissions.mockImplementation((id) => Promise.resolve({ id } as never));
		boardNodeRule.can.mockReturnValue(true);
		boardProgressService.computeBoardsProgress.mockResolvedValue([
			{ boardId: board.id, boardTitle: board.title, isTeacherView: false, summary: { done: 0, total: 0 }, items: [] },
		]);
	});

	it('throws when the feature flag is off', async () => {
		const uc = buildUc({ featureBoardProgressEnabled: false });

		await expect(uc.getBoardProgress(studentId, board.id)).rejects.toThrow(ForbiddenException);
	});

	it('throws when the user cannot access the board', async () => {
		const uc = buildUc({ featureBoardProgressEnabled: true });
		boardNodeRule.can.mockReturnValue(false);

		await expect(uc.getBoardProgress(studentId, board.id)).rejects.toThrow(ForbiddenException);
	});

	it('only enables the element types whose feature flag is on', async () => {
		const uc = buildUc({
			featureBoardProgressEnabled: true,
			featureColumnBoardCheckboxEnabled: true,
			featureColumnBoardAssignmentEnabled: false,
			featureColumnBoardPollEnabled: false,
		});
		boardNodeRule.can.mockImplementation((operation) => operation === 'findBoard');

		await uc.getBoardProgress(studentId, board.id);

		expect(boardProgressService.computeBoardsProgress).toHaveBeenCalledWith(
			studentId,
			[{ board, auth, isTeacherView: false }],
			['checkbox-element'],
			{ includeStudents: false }
		);
	});

	it('marks the view as teacher progress for a teacher who is a board editor, and forwards details', async () => {
		const uc = buildUc({ featureBoardProgressEnabled: true, featureColumnBoardCheckboxEnabled: true });
		boardNodeRule.can.mockImplementation(() => true);

		await uc.getBoardProgress(teacherId, board.id, true);

		expect(boardProgressService.computeBoardsProgress).toHaveBeenCalledWith(
			teacherId,
			[{ board, auth, isTeacherView: true }],
			expect.any(Array),
			{ includeStudents: true }
		);
	});

	it('does not treat a non-teacher board editor as a teacher view', async () => {
		const uc = buildUc({ featureBoardProgressEnabled: true, featureColumnBoardCheckboxEnabled: true });
		boardNodeRule.can.mockImplementation(() => true);

		await uc.getBoardProgress(studentId, board.id, true);

		expect(boardProgressService.computeBoardsProgress).toHaveBeenCalledWith(
			studentId,
			[{ board, auth, isTeacherView: false }],
			expect.any(Array),
			{ includeStudents: false }
		);
	});
});
