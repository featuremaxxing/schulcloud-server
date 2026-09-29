import { createMock } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { type AuthorizationService } from '@modules/authorization';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type BoardNodeRule } from '../authorisation/board-node.rule';
import { BoardNodeAuthorizable, BoardRoles, CheckboxElement, PollAudience, ROOT_PATH } from '../domain';
import { type BoardNodeAuthorizableService, type BoardNodeService } from '../service';
import { CheckboxUc } from './checkbox.uc';

describe('CheckboxUc', () => {
	const teacher = new ObjectId().toHexString();
	const student = new ObjectId().toHexString();
	const otherStudent = new ObjectId().toHexString();
	const element = new CheckboxElement({
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		text: 'Task',
		requireTeacherConfirmation: true,
		creatorId: teacher,
		entries: [],
	});
	const auth = new BoardNodeAuthorizable({
		id: element.id,
		boardNode: element,
		rootNode: element,
		users: [
			{ userId: teacher, roles: [BoardRoles.EDITOR], firstName: 'Teacher' },
			{ userId: student, roles: [BoardRoles.READER], firstName: 'Alice' },
			{ userId: otherStudent, roles: [BoardRoles.READER], firstName: 'Bob' },
		],
		boardConfiguration: {},
	});
	const authorizationService = createMock<AuthorizationService>();
	const authorizableService = createMock<BoardNodeAuthorizableService>();
	const nodeService = createMock<BoardNodeService>();
	const rule = createMock<BoardNodeRule>();
	const uc = new CheckboxUc(authorizationService, authorizableService, nodeService, rule);

	beforeEach(() => {
		jest.clearAllMocks();
		element.entries = [];
		element.requireTeacherConfirmation = true;
		element.audience = PollAudience.STUDENTS;
		element.audienceRoles = undefined;
		nodeService.findContentElementById.mockResolvedValue(element);
		authorizableService.getBoardAuthorizable.mockResolvedValue(auth);
		authorizationService.getUserWithPermissions.mockImplementation((id) => Promise.resolve({ id } as never));
		rule.can.mockImplementation(
			(operation, user) => operation === 'viewElement' || (operation === 'isBoardEditor' && user.id === teacher)
		);
		nodeService.mutateCheckboxEntries.mockImplementation((_id, change) => {
			const result = change(
				element.entries.map((entry) => {
					return { ...entry };
				})
			);
			element.entries = result;
			return Promise.resolve(result);
		});
	});

	it('allows other eligible teacher participants, but only the teacher creator can approve and see the list', async () => {
		const colleague = new ObjectId().toHexString();
		auth.users.push({ userId: colleague, roles: [BoardRoles.EDITOR], firstName: 'Colleague' });
		try {
			element.audience = PollAudience.TEACHERS;
			await uc.check(colleague, element.id, true);
			expect((await uc.get(colleague, element.id)).myEntry).toEqual({ checked: true, approved: false });
			expect((await uc.get(colleague, element.id)).canManage).toBe(false);
			await expect(uc.check(teacher, element.id, true)).rejects.toThrow(ForbiddenException);
			await expect(uc.approve(colleague, element.id, colleague, true)).rejects.toThrow(ForbiddenException);
			await uc.approve(teacher, element.id, colleague, true);
			expect((await uc.get(teacher, element.id)).entries).toEqual([
				expect.objectContaining({ userId: colleague, checked: true, approved: true }),
			]);
		} finally {
			auth.users.pop();
		}
	});

	it('supports custom board roles; an empty custom audience admits no participants', async () => {
		element.audience = PollAudience.CUSTOM;
		element.audienceRoles = [BoardRoles.READER];
		await uc.check(student, element.id, true);
		element.audienceRoles = [];
		await expect(uc.check(otherStudent, element.id, true)).rejects.toThrow(ForbiddenException);
		expect((await uc.get(student, element.id)).myEntry).toBeUndefined();
	});

	it('isolates individual student state and gives teachers a list of all students including unchecked ones', async () => {
		await uc.check(student, element.id, true);
		expect(await uc.get(otherStudent, element.id)).toEqual({
			canManage: false,
			hasCheckActivity: true,
			myEntry: { checked: false, approved: false },
			entries: undefined,
		});
		const result = await uc.get(teacher, element.id);
		expect(result.myEntry).toBeUndefined();
		expect(result.hasCheckActivity).toBe(true);
		expect(result.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ userId: student, checked: true, approved: false }),
				expect.objectContaining({ userId: otherStudent, checked: false, approved: false }),
			])
		);
	});

	it('locks approved student state until a teacher revokes confirmation', async () => {
		await uc.check(student, element.id, true);
		await uc.approve(teacher, element.id, student, true);
		expect((await uc.get(student, element.id)).myEntry).toEqual({ checked: true, approved: true });
		await expect(uc.check(student, element.id, false)).rejects.toThrow(ForbiddenException);
		expect((await uc.get(student, element.id)).myEntry).toEqual({ checked: true, approved: true });
		await uc.approve(teacher, element.id, student, false);
		await uc.check(student, element.id, false);
		expect((await uc.get(student, element.id)).myEntry).toEqual({ checked: false, approved: false });
		expect((await uc.get(teacher, element.id)).hasCheckActivity).toBe(true);
		expect(nodeService.mutateCheckboxEntries).toHaveBeenCalledTimes(5);
	});

	it('rejects teacher checking, student approving, and approval of unchecked items', async () => {
		await expect(uc.check(teacher, element.id, true)).rejects.toThrow(ForbiddenException);
		await expect(uc.approve(student, element.id, student, true)).rejects.toThrow(ForbiddenException);
		await expect(uc.approve(teacher, element.id, student, true)).rejects.toThrow(ForbiddenException);
		await expect(uc.approve(teacher, element.id, new ObjectId().toHexString(), true)).rejects.toThrow(
			NotFoundException
		);
	});

	it('does not persist redundant requests', async () => {
		await uc.check(student, element.id, true);
		await uc.check(student, element.id, true);
		await uc.approve(teacher, element.id, student, true);
		await uc.approve(teacher, element.id, student, true);
		expect(nodeService.mutateCheckboxEntries).toHaveBeenCalledTimes(4);
	});
});
