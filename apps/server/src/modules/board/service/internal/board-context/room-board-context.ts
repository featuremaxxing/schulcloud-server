import { RoleName } from '@modules/role';
import { type Room, RoomFeatures } from '@modules/room';
import { type RoomAuthorizable, type UserWithRoomRoles } from '@modules/room-membership';
import { Permission } from '@shared/domain/interface';
import { type EntityId } from '@shared/domain/types';
import {
	type BoardConfiguration,
	BoardExternalReferenceType,
	BoardRoles,
	ColumnBoard,
	type MediaBoard,
	type UserWithBoardRoles,
} from '../../../domain';
import { type PreparedBoardContext } from './prepared-board-context.interface';

/**
 * Prepared context for Room-based boards.
 * Holds pre-fetched Room and RoomAuthorizable data.
 */
export class RoomBoardContext implements PreparedBoardContext {
	public readonly type = BoardExternalReferenceType.Room;

	private readonly hasOwner: boolean;

	private readonly canEditorsManageVideoconference: boolean;

	// Memoizes the one call to loadUserInfo across however many times this context's
	// getUsersWithBoardRoles() is called within a request - see the constructor doc.
	private usersWithBoardRolesPromise: Promise<UserWithBoardRoles[]> | undefined;

	constructor(
		private readonly room: Room,
		private readonly roomAuthorizable: RoomAuthorizable,
		// Room memberships carry no user names or school roles - the resolver would otherwise
		// have to load them (a separate DB round-trip, UserService.getUserEntitiesWithRoles) on
		// every single board-node access (getBoardAuthorizable runs on every board operation,
		// including every socket message), even though most callers (e.g. the assignment teacher
		// overview, isStudentMember) never read names/school roles at all. Deferred to a loader
		// instead, called at most once, only if getUsersWithBoardRoles() is actually invoked.
		private readonly loadUserInfo: () => Promise<
			Map<EntityId, { firstName?: string; lastName?: string; schoolRoleNames?: RoleName[] }>
		> = () =>
			Promise.resolve(new Map<EntityId, { firstName?: string; lastName?: string; schoolRoleNames?: RoleName[] }>())
	) {
		this.hasOwner = this.computeHasOwner();
		this.canEditorsManageVideoconference = this.room.features.includes(RoomFeatures.EDITOR_MANAGE_VIDEOCONFERENCE);
	}

	public getUsersWithBoardRoles(): Promise<UserWithBoardRoles[]> {
		if (!this.usersWithBoardRolesPromise) {
			this.usersWithBoardRolesPromise = this.computeUsersWithBoardRoles();
		}

		return this.usersWithBoardRolesPromise;
	}

	public getBoardConfiguration(rootNode: MediaBoard | ColumnBoard): BoardConfiguration {
		const isColumnBoard = rootNode instanceof ColumnBoard;

		return {
			canEditorsManageVideoconference: isColumnBoard && this.canEditorsManageVideoconference,
			canReadersEdit: this.determineCanReadersEdit(rootNode),
			canAdminsToggleReadersCanEdit: isColumnBoard,
			isLocked: !this.hasOwner,
		};
	}

	private async computeUsersWithBoardRoles(): Promise<UserWithBoardRoles[]> {
		const userInfo = await this.loadUserInfo();

		return this.roomAuthorizable.members.map((member) => {
			const info = userInfo.get(member.userId);

			return {
				userId: member.userId,
				firstName: info?.firstName,
				lastName: info?.lastName,
				roles: this.getBoardRolesFromRoomMembership(member),
				schoolRoleNames: info?.schoolRoleNames,
			};
		});
	}

	private computeHasOwner(): boolean {
		return this.roomAuthorizable.members.some((member) =>
			member.roles.some((role) => role.name === RoleName.ROOMOWNER)
		);
	}

	private determineCanReadersEdit(rootNode: MediaBoard | ColumnBoard): boolean {
		if ('readersCanEdit' in rootNode && rootNode.readersCanEdit !== undefined) {
			return rootNode.readersCanEdit;
		}
		return false;
	}

	private getBoardRolesFromRoomMembership(member: UserWithRoomRoles): BoardRoles[] {
		const permissions = member.roles.flatMap((role) => role.permissions ?? []);

		const isReader = permissions.includes(Permission.ROOM_LIST_CONTENT);
		const isEditor = permissions.includes(Permission.ROOM_EDIT_CONTENT);
		const isRoomAdmin = permissions.includes(Permission.ROOM_ADD_MEMBERS);
		const isRoomOwner = permissions.includes(Permission.ROOM_CHANGE_OWNER);
		const isBoardAdmin = isRoomAdmin || isRoomOwner;

		if (isBoardAdmin) {
			return [BoardRoles.EDITOR, BoardRoles.ADMIN];
		}
		if (isEditor) {
			return [BoardRoles.EDITOR];
		}
		if (isReader) {
			return [BoardRoles.READER];
		}
		return [];
	}
}
