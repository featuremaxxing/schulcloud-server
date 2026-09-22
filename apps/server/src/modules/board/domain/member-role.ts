import { RoleName } from '@modules/role';
import { BoardRoles, type UserWithBoardRoles } from './board-node-authorizable.do';

// "student" in a room, based on the school-level role when available. This is the
// authoritative definition: a teacher who only has viewer/reader board rights in a
// particular room (e.g. a substitute browsing another class's room) must NOT be treated
// as a student there just because their board role happens to be READER.
//
// Falls back to the board-role heuristic (READER without EDITOR/ADMIN) for contexts that
// don't resolve school roles (MediaBoard, User context) - same behavior as before
// schoolRoleNames existed.
export const isStudentMember = (member: UserWithBoardRoles): boolean => {
	if (member.schoolRoleNames?.length) {
		return member.schoolRoleNames.includes(RoleName.STUDENT);
	}

	return isPlainBoardReader(member);
};

// "teacher" in a room, based on the school-level role when available. Falls back to the
// board-role heuristic (EDITOR or ADMIN) for contexts without school roles.
export const isTeacherMember = (member: UserWithBoardRoles): boolean => {
	if (member.schoolRoleNames?.length) {
		return member.schoolRoleNames.includes(RoleName.TEACHER);
	}

	return isBoardStaff(member);
};

const isPlainBoardReader = (member: UserWithBoardRoles): boolean => {
	const isReader = member.roles.includes(BoardRoles.READER);

	return isReader && !isBoardStaff(member);
};

const isBoardStaff = (member: UserWithBoardRoles): boolean =>
	[BoardRoles.EDITOR, BoardRoles.ADMIN].some((role) => member.roles.includes(role));
