import { AuthorizationService } from '@modules/authorization';
import { RoleName } from '@modules/role';
import { RoomMembershipService } from '@modules/room-membership';
import { RoomRule } from '@modules/room-membership/authorization/room.rule';
import { Injectable } from '@nestjs/common';
import { TypeGuard } from '@shared/common/guards';
import { EntityId } from '@shared/domain/types';
import { RoomArrangementService, RoomService } from '../domain';
import { RoomArrangement } from '../domain/type';
import { RoomListWithTags } from './type/room-list-with-tags';
import { throwForbiddenIfFalse } from '@shared/common/utils/wrap-with-exception';

@Injectable()
export class RoomArrangementUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly roomMembershipService: RoomMembershipService,
		private readonly roomService: RoomService,
		private readonly roomArrangementService: RoomArrangementService,
		private readonly roomRule: RoomRule
	) {}

	public async getRoomsByUserArrangement(userId: EntityId): Promise<RoomListWithTags> {
		const accessibleRoomAuthorizables = await this.roomMembershipService.getRoomAuthorizablesByUserId(userId);
		const roomIds = accessibleRoomAuthorizables.map((item) => item.roomId);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		const rooms = await this.roomService.getRoomsByIds(roomIds);
		const existingRoomIds = rooms.map((room) => room.id);
		const arrangement = await this.roomArrangementService.getArrangement(userId, existingRoomIds);
		const orderedRoomIds = arrangement.items.map((item) => item.id);
		const tagIdsByRoomId = new Map(arrangement.items.map((item) => [item.id, item.tagIds]));
		rooms.sort((a, b) => orderedRoomIds.indexOf(a.id) - orderedRoomIds.indexOf(b.id));

		const roomsWithAllowedOperationsAndLockedStatus = rooms
			.map((room) => {
				const roomAuthorizable = accessibleRoomAuthorizables.find((item) => item.roomId === room.id);
				if (!roomAuthorizable) return null;
				const allowedOperations = this.roomRule.listAllowedOperations(user, roomAuthorizable);

				const hasOwner = accessibleRoomAuthorizables.some(
					(item) =>
						item.roomId === room.id &&
						item.members.some((member) => member.roles.some((role) => role.name === RoleName.ROOMOWNER))
				);
				return {
					room,
					allowedOperations,
					isLocked: !hasOwner,
					totalMembers: roomAuthorizable.members.length,
					tagIds: tagIdsByRoomId.get(room.id),
				};
			})
			.filter((room) => TypeGuard.isNotNullOrUndefined(room));

		return { rooms: roomsWithAllowedOperationsAndLockedStatus, tags: arrangement.tags };
	}

	public async moveRoomInUserArrangement(userId: EntityId, roomId: EntityId, toPosition: number): Promise<void> {
		const roomAuthorizable = await this.roomMembershipService.getRoomAuthorizable(roomId);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.roomRule.can('arrangeRooms', user, roomAuthorizable));

		await this.roomArrangementService.moveRoom(userId, roomId, toPosition);
	}

	public async setRoomTags(userId: EntityId, roomId: EntityId, names: string[]): Promise<RoomArrangement> {
		const roomAuthorizable = await this.roomMembershipService.getRoomAuthorizable(roomId);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.roomRule.can('arrangeRooms', user, roomAuthorizable));

		const arrangement = await this.roomArrangementService.setRoomTags(userId, roomId, names);

		return arrangement;
	}

	public async renameTag(userId: EntityId, tagId: EntityId, name: string): Promise<void> {
		await this.roomArrangementService.renameTag(userId, tagId, name);
	}

	public async deleteTag(userId: EntityId, tagId: EntityId): Promise<void> {
		await this.roomArrangementService.deleteTag(userId, tagId);
	}
}
