import { RoleName } from '@modules/role';
import { BoardRoles, type UserWithBoardRoles } from './board-node-authorizable.do';
import { isStudentMember, isTeacherMember } from './member-role';

const member = (props: Partial<UserWithBoardRoles>): UserWithBoardRoles => {
	return {
		userId: 'user-1',
		roles: [],
		...props,
	};
};

describe('isStudentMember', () => {
	describe('when schoolRoleNames is present', () => {
		it('should return true for a STUDENT school role, regardless of board role', () => {
			// a student who happens to have been granted EDITOR rights in this room is still
			// a student for target-audience purposes
			const result = isStudentMember(member({ schoolRoleNames: [RoleName.STUDENT], roles: [BoardRoles.EDITOR] }));

			expect(result).toBe(true);
		});

		it('should return false for a TEACHER school role, even with a READER board role', () => {
			// this is the whole point: a teacher browsing as a room viewer must not be
			// mistaken for a student
			const result = isStudentMember(member({ schoolRoleNames: [RoleName.TEACHER], roles: [BoardRoles.READER] }));

			expect(result).toBe(false);
		});
	});

	describe('when schoolRoleNames is absent', () => {
		it('should fall back to the plain-reader board-role heuristic', () => {
			expect(isStudentMember(member({ roles: [BoardRoles.READER] }))).toBe(true);
			expect(isStudentMember(member({ roles: [BoardRoles.READER, BoardRoles.EDITOR] }))).toBe(false);
			expect(isStudentMember(member({ roles: [BoardRoles.EDITOR] }))).toBe(false);
		});
	});
});

describe('isTeacherMember', () => {
	describe('when schoolRoleNames is present', () => {
		it('should return true for a TEACHER school role, even with a READER board role', () => {
			const result = isTeacherMember(member({ schoolRoleNames: [RoleName.TEACHER], roles: [BoardRoles.READER] }));

			expect(result).toBe(true);
		});

		it('should return false for a STUDENT school role, even with an EDITOR board role', () => {
			const result = isTeacherMember(member({ schoolRoleNames: [RoleName.STUDENT], roles: [BoardRoles.EDITOR] }));

			expect(result).toBe(false);
		});
	});

	describe('when schoolRoleNames is absent', () => {
		it('should fall back to the board-staff heuristic', () => {
			expect(isTeacherMember(member({ roles: [BoardRoles.EDITOR] }))).toBe(true);
			expect(isTeacherMember(member({ roles: [BoardRoles.ADMIN] }))).toBe(true);
			expect(isTeacherMember(member({ roles: [BoardRoles.READER] }))).toBe(false);
		});
	});
});
