import { type AuthorizableObject, DomainObject } from '@shared/domain/domain-object';
import { Permission } from '@shared/domain/interface';
import { type EntityId } from '@shared/domain/types';
import { type RoleName } from '@modules/role';
import { type AnyBoardNode } from './types';

export enum BoardRoles {
	EDITOR = 'editor',
	READER = 'reader',
	ADMIN = 'admin',
}

export interface UserWithBoardRoles {
	firstName?: string;
	lastName?: string;
	roles: BoardRoles[];
	userId: EntityId;
	// School-level role (STUDENT/TEACHER/...), independent of the board role above - a
	// board reader can be a teacher who only has viewing rights in this particular room.
	// Undefined for contexts that don't resolve school roles (e.g. MediaBoard/User context);
	// consumers must fall back to the board role heuristic in that case (see
	// isStudentMember/isTeacherMember in ./member-role).
	schoolRoleNames?: RoleName[];
}

export interface BoardNodeAuthorizableProps extends AuthorizableObject {
	id: EntityId;
	users: UserWithBoardRoles[];
	boardNode: AnyBoardNode;
	rootNode: AnyBoardNode;
	parentNode?: AnyBoardNode;
	boardConfiguration: BoardConfiguration;
}

export interface BoardConfiguration {
	canEditorsManageVideoconference?: boolean;
	canReadersEdit?: boolean;
	canAdminsToggleReadersCanEdit?: boolean;
	isLocked?: boolean;
}

export class BoardNodeAuthorizable extends DomainObject<BoardNodeAuthorizableProps> {
	get users(): UserWithBoardRoles[] {
		return this.props.users;
	}

	get boardNode(): AnyBoardNode {
		return this.props.boardNode;
	}

	// TODO should we really be able to alter that? (check BoardNodeRule)
	set boardNode(boardNode: AnyBoardNode) {
		this.props.boardNode = boardNode;
	}

	get parentNode(): AnyBoardNode | undefined {
		return this.props.parentNode;
	}

	// TODO should we really be able to alter that? (check BoardNodeRule)
	set parentNode(boardNode: AnyBoardNode | undefined) {
		this.props.parentNode = boardNode;
	}

	get rootNode(): AnyBoardNode {
		return this.props.rootNode;
	}

	get boardConfiguration(): BoardConfiguration {
		return this.props.boardConfiguration;
	}

	public getUserPermissions(userId: EntityId): Permission[] {
		const user = this.users.find((user) => user.userId === userId);
		if (user?.roles.includes(BoardRoles.ADMIN)) {
			return [
				Permission.BOARD_VIEW,
				Permission.BOARD_EDIT,
				Permission.BOARD_MANAGE_VIDEOCONFERENCE,
				Permission.BOARD_MANAGE_READERS_CAN_EDIT,
				Permission.BOARD_MANAGE,
				Permission.BOARD_SHARE_BOARD,
				Permission.BOARD_RELOCATE_CONTENT,
			];
		}

		if (user?.roles.includes(BoardRoles.EDITOR)) {
			return [Permission.BOARD_VIEW, Permission.BOARD_EDIT, Permission.BOARD_MANAGE];
		}

		if (user?.roles.includes(BoardRoles.READER)) {
			const permissions = [Permission.BOARD_VIEW];
			return permissions;
		}

		return [];
	}
}
