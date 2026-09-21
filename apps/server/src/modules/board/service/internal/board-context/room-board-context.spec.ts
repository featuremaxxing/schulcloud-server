import { ObjectId } from '@mikro-orm/mongodb';
import { RoleName } from '@modules/role';
import { roleFactory } from '@modules/role/testing';
import { RoomFeatures } from '@modules/room';
import { RoomAuthorizable, type UserWithRoomRoles } from '@modules/room-membership';
import { roomFactory } from '@modules/room/testing';
import { Permission } from '@shared/domain/interface';
import { BoardExternalReferenceType, BoardRoles } from '../../../domain';
import { columnBoardFactory, mediaBoardFactory } from '../../../testing';
import { RoomBoardContext } from './room-board-context';

describe(RoomBoardContext.name, () => {
	describe('constructor', () => {
		it('should set the type to Room', () => {
			const room = roomFactory.build();
			const roomAuthorizable = new RoomAuthorizable(room.id, [], room.schoolId);

			const context = new RoomBoardContext(room, roomAuthorizable);

			expect(context.type).toBe(BoardExternalReferenceType.Room);
		});
	});

	describe('getUsersWithBoardRoles', () => {
		describe('when room has no members', () => {
			it('should return empty array', async () => {
				const room = roomFactory.build();
				const roomAuthorizable = new RoomAuthorizable(room.id, [], room.schoolId);

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = await context.getUsersWithBoardRoles();

				expect(result).toEqual([]);
			});
		});

		describe('when room has members with ROOM_LIST_CONTENT permission', () => {
			it('should return users with READER role', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const role = roleFactory.build({ permissions: [Permission.ROOM_LIST_CONTENT] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = await context.getUsersWithBoardRoles();

				expect(result).toEqual([
					{
						userId,
						roles: [BoardRoles.READER],
					},
				]);
			});
		});

		describe('when room has members with ROOM_EDIT_CONTENT permission', () => {
			it('should return users with EDITOR role', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const role = roleFactory.build({ permissions: [Permission.ROOM_EDIT_CONTENT] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = await context.getUsersWithBoardRoles();

				expect(result).toEqual([
					{
						userId,
						roles: [BoardRoles.EDITOR],
					},
				]);
			});
		});

		describe('when room has members with ROOM_ADD_MEMBERS permission', () => {
			it('should return users with EDITOR and ADMIN roles', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const role = roleFactory.build({ permissions: [Permission.ROOM_ADD_MEMBERS] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = await context.getUsersWithBoardRoles();

				expect(result).toEqual([
					{
						userId,
						roles: [BoardRoles.EDITOR, BoardRoles.ADMIN],
					},
				]);
			});
		});

		describe('when room has members with ROOM_CHANGE_OWNER permission', () => {
			it('should return users with EDITOR and ADMIN roles', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const role = roleFactory.build({ permissions: [Permission.ROOM_CHANGE_OWNER] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = await context.getUsersWithBoardRoles();

				expect(result).toEqual([
					{
						userId,
						roles: [BoardRoles.EDITOR, BoardRoles.ADMIN],
					},
				]);
			});
		});

		describe('when userNames are provided for a member', () => {
			it('should include firstName and lastName for that member', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const role = roleFactory.build({ permissions: [Permission.ROOM_LIST_CONTENT] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);
				const userNames = new Map([[userId, { firstName: 'Anna', lastName: 'Beispiel' }]]);

				const context = new RoomBoardContext(room, roomAuthorizable, () => Promise.resolve(userNames));
				const result = await context.getUsersWithBoardRoles();

				expect(result).toEqual([
					{
						userId,
						firstName: 'Anna',
						lastName: 'Beispiel',
						roles: [BoardRoles.READER],
					},
				]);
			});
		});

		describe('when no userNames are provided', () => {
			it('should leave firstName and lastName undefined', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const role = roleFactory.build({ permissions: [Permission.ROOM_LIST_CONTENT] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = await context.getUsersWithBoardRoles();

				expect(result[0].firstName).toBeUndefined();
				expect(result[0].lastName).toBeUndefined();
			});
		});

		describe('when the resolver provides school role names', () => {
			it('should attach the school role names to the board roles', async () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				// a teacher who is only a room viewer here - board role and school role diverge
				const role = roleFactory.build({ permissions: [Permission.ROOM_LIST_CONTENT] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [role],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);
				const userInfo = new Map([[userId, { schoolRoleNames: [RoleName.TEACHER] }]]);

				const context = new RoomBoardContext(room, roomAuthorizable, () => Promise.resolve(userInfo));
				const result = await context.getUsersWithBoardRoles();

				expect(result[0].roles).toEqual([BoardRoles.READER]);
				expect(result[0].schoolRoleNames).toEqual([RoleName.TEACHER]);
			});
		});
	});

	describe('getBoardConfiguration', () => {
		describe('when room has an owner', () => {
			const setup = () => {
				const userId = new ObjectId().toHexString();
				const schoolId = new ObjectId().toHexString();
				const ownerRole = roleFactory.build({ name: RoleName.ROOMOWNER, permissions: [Permission.ROOM_CHANGE_OWNER] });
				const member: UserWithRoomRoles = {
					userId,
					userSchoolId: schoolId,
					roles: [ownerRole],
				};
				const room = roomFactory.build({ schoolId });
				const roomAuthorizable = new RoomAuthorizable(room.id, [member], room.schoolId);

				return { room, roomAuthorizable };
			};

			it('should return isLocked as false', () => {
				const { room, roomAuthorizable } = setup();
				const columnBoard = columnBoardFactory.build();

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = context.getBoardConfiguration(columnBoard);

				expect(result.isLocked).toBe(false);
			});
		});

		describe('when room has no owner', () => {
			const setup = () => {
				const room = roomFactory.build();
				const roomAuthorizable = new RoomAuthorizable(room.id, [], room.schoolId);

				return { room, roomAuthorizable };
			};

			it('should return isLocked as true', () => {
				const { room, roomAuthorizable } = setup();
				const columnBoard = columnBoardFactory.build();

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = context.getBoardConfiguration(columnBoard);

				expect(result.isLocked).toBe(true);
			});
		});

		describe('when room has EDITOR_MANAGE_VIDEOCONFERENCE feature', () => {
			const setup = () => {
				const room = roomFactory.build({ features: [RoomFeatures.EDITOR_MANAGE_VIDEOCONFERENCE] });
				const roomAuthorizable = new RoomAuthorizable(room.id, [], room.schoolId);

				return { room, roomAuthorizable };
			};

			describe('and rootNode is a ColumnBoard', () => {
				it('should return canEditorsManageVideoconference as true', () => {
					const { room, roomAuthorizable } = setup();
					const columnBoard = columnBoardFactory.build();

					const context = new RoomBoardContext(room, roomAuthorizable);
					const result = context.getBoardConfiguration(columnBoard);

					expect(result.canEditorsManageVideoconference).toBe(true);
				});

				it('should return canAdminsToggleReadersCanEdit as true', () => {
					const { room, roomAuthorizable } = setup();
					const columnBoard = columnBoardFactory.build();

					const context = new RoomBoardContext(room, roomAuthorizable);
					const result = context.getBoardConfiguration(columnBoard);

					expect(result.canAdminsToggleReadersCanEdit).toBe(true);
				});
			});

			describe('and rootNode is a MediaBoard', () => {
				it('should return canEditorsManageVideoconference as false', () => {
					const { room, roomAuthorizable } = setup();
					const mediaBoard = mediaBoardFactory.build();

					const context = new RoomBoardContext(room, roomAuthorizable);
					const result = context.getBoardConfiguration(mediaBoard);

					expect(result.canEditorsManageVideoconference).toBe(false);
				});

				it('should return canAdminsToggleReadersCanEdit as false', () => {
					const { room, roomAuthorizable } = setup();
					const mediaBoard = mediaBoardFactory.build();

					const context = new RoomBoardContext(room, roomAuthorizable);
					const result = context.getBoardConfiguration(mediaBoard);

					expect(result.canAdminsToggleReadersCanEdit).toBe(false);
				});
			});
		});

		describe('when rootNode has readersCanEdit set to true', () => {
			it('should return canReadersEdit as true', () => {
				const room = roomFactory.build();
				const roomAuthorizable = new RoomAuthorizable(room.id, [], room.schoolId);
				const columnBoard = columnBoardFactory.build({ readersCanEdit: true });

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = context.getBoardConfiguration(columnBoard);

				expect(result.canReadersEdit).toBe(true);
			});
		});

		describe('when rootNode has readersCanEdit set to false', () => {
			it('should return canReadersEdit as false', () => {
				const room = roomFactory.build();
				const roomAuthorizable = new RoomAuthorizable(room.id, [], room.schoolId);
				const columnBoard = columnBoardFactory.build({ readersCanEdit: false });

				const context = new RoomBoardContext(room, roomAuthorizable);
				const result = context.getBoardConfiguration(columnBoard);

				expect(result.canReadersEdit).toBe(false);
			});
		});
	});
});
