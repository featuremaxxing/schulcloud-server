import { RoleName } from '@modules/role';
import {
	type BoardConfiguration,
	BoardExternalReferenceType,
	BoardRoles,
	type ColumnBoard,
	type MediaBoard,
	type UserWithBoardRoles,
} from '../../../domain';
import { type PreparedBoardContext } from './prepared-board-context.interface';

export interface CourseUserInfo {
	userId: string;
	firstName?: string;
	lastName?: string;
}

export interface CourseBoardContextData {
	teachers: CourseUserInfo[];
	substitutionTeachers: CourseUserInfo[];
	students: CourseUserInfo[];
}

/**
 * Prepared context for Course-based boards.
 * Holds pre-fetched course user data.
 */
export class CourseBoardContext implements PreparedBoardContext {
	public readonly type = BoardExternalReferenceType.Course;

	private readonly usersWithBoardRoles: UserWithBoardRoles[];

	private readonly hasTeachers: boolean;

	constructor(private readonly data: CourseBoardContextData) {
		this.usersWithBoardRoles = this.computeUsersWithBoardRoles();
		this.hasTeachers = data.teachers.length > 0;
	}

	public getUsersWithBoardRoles(): Promise<UserWithBoardRoles[]> {
		return Promise.resolve(this.usersWithBoardRoles);
	}

	public getBoardConfiguration(_rootNode: MediaBoard | ColumnBoard): BoardConfiguration {
		return {
			canEditorsManageVideoconference: false,
			canReadersEdit: false,
			canAdminsToggleReadersCanEdit: false,
			isLocked: !this.hasTeachers,
		};
	}

	private computeUsersWithBoardRoles(): UserWithBoardRoles[] {
		// Course membership determines the school role unambiguously here (unlike rooms,
		// where a member's board role and school role can diverge) - teachers and
		// substitution teachers are always RoleName.TEACHER, students RoleName.STUDENT.
		const teacherRoles: UserWithBoardRoles[] = this.data.teachers.map((user) => {
			return {
				userId: user.userId,
				firstName: user.firstName,
				lastName: user.lastName,
				roles: [BoardRoles.EDITOR, BoardRoles.ADMIN],
				schoolRoleNames: [RoleName.TEACHER],
			};
		});

		const substitutionTeacherRoles: UserWithBoardRoles[] = this.data.substitutionTeachers.map((user) => {
			return {
				userId: user.userId,
				firstName: user.firstName,
				lastName: user.lastName,
				roles: [BoardRoles.EDITOR, BoardRoles.ADMIN],
				schoolRoleNames: [RoleName.TEACHER],
			};
		});

		const studentRoles: UserWithBoardRoles[] = this.data.students.map((user) => {
			return {
				userId: user.userId,
				firstName: user.firstName,
				lastName: user.lastName,
				roles: [BoardRoles.READER],
				schoolRoleNames: [RoleName.STUDENT],
			};
		});

		return [...teacherRoles, ...substitutionTeacherRoles, ...studentRoles];
	}
}
