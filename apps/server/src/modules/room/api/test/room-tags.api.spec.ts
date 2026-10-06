import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { GroupEntityTypes } from '@modules/group/entity/group.entity';
import { groupEntityFactory } from '@modules/group/testing';
import { roomMembershipEntityFactory } from '@modules/room-membership/testing/room-membership-entity.factory';
import { roomArrangementEntityFactory } from '@modules/room/testing';
import { RoomRolesTestFactory } from '@modules/room/testing/room-roles.test.factory';
import { schoolEntityFactory } from '@modules/school/testing';
import { ServerTestModule } from '@modules/server';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import { TestApiClient } from '@testing/test-api-client';
import { RoomArrangementEntity } from '../../repo';
import { roomEntityFactory } from '../../testing/room-entity.factory';
import { type RoomListResponse } from '../dto/response/room-list.response';
import { type RoomTagsResponse } from '../dto/response/room-tags.response';

describe('Room Controller (API)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let testApiClient: TestApiClient;

	const mathe = { id: new ObjectId().toHexString(), name: 'Mathe' };
	const physik = { id: new ObjectId().toHexString(), name: 'Physik' };

	beforeAll(async () => {
		const moduleFixture = await Test.createTestingModule({
			imports: [ServerTestModule],
		}).compile();

		app = moduleFixture.createNestApplication();
		await app.init();
		em = app.get(EntityManager);
		testApiClient = new TestApiClient(app, 'rooms');
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	afterAll(async () => {
		await app.close();
	});

	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const rooms = roomEntityFactory.buildListWithId(2, { schoolId: school.id });
		const otherRoom = roomEntityFactory.buildWithId({ schoolId: school.id });
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher({ school });
		const { roomOwnerRole } = RoomRolesTestFactory.createRoomRoles();
		const userGroupEntity = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [{ role: roomOwnerRole, user: teacherUser }],
			organization: teacherUser.school,
			externalSource: undefined,
		});
		const roomMemberships = rooms.map((room) =>
			roomMembershipEntityFactory.build({ userGroupId: userGroupEntity.id, roomId: room.id, schoolId: school.id })
		);
		const otherGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [],
			organization: teacherUser.school,
			externalSource: undefined,
		});
		const otherMembership = roomMembershipEntityFactory.build({
			userGroupId: otherGroup.id,
			roomId: otherRoom.id,
			schoolId: school.id,
		});
		const roomArrangement = roomArrangementEntityFactory.build({
			userId: teacherUser.id,
			items: [
				{ id: rooms[0].id, tagIds: [mathe.id] },
				{ id: rooms[1].id, tagIds: [mathe.id, physik.id] },
			],
			tags: [mathe, physik],
		});
		await em
			.persist([
				...rooms,
				otherRoom,
				teacherAccount,
				teacherUser,
				roomOwnerRole,
				userGroupEntity,
				otherGroup,
				...roomMemberships,
				otherMembership,
				roomArrangement,
			])
			.flush();
		em.clear();

		const loggedInClient = await testApiClient.login(teacherAccount);
		const findArrangement = () => em.findOneOrFail(RoomArrangementEntity, { userId: teacherUser.id });

		return { loggedInClient, rooms, otherRoom, findArrangement };
	};

	describe('GET /rooms', () => {
		it('should return the tags of the rooms and of the user', async () => {
			const { loggedInClient, rooms } = await setup();

			const response = await loggedInClient.get();

			const body = response.body as RoomListResponse;
			expect(body.tags).toEqual([mathe, physik]);
			expect(body.data.map((room) => [room.id, room.tagIds])).toEqual([
				[rooms[0].id, [mathe.id]],
				[rooms[1].id, [mathe.id, physik.id]],
			]);
		});
	});

	describe('PUT /rooms/:roomId/tags', () => {
		it('should return a 401 error when not authenticated', async () => {
			const response = await testApiClient.put(`${new ObjectId().toHexString()}/tags`, { names: [] });

			expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
		});

		it('should set the tags by name and create new ones', async () => {
			const { loggedInClient, rooms } = await setup();

			const response = await loggedInClient.put(`${rooms[0].id}/tags`, { names: ['physik', 'Klasse 7a'] });

			expect(response.status).toBe(HttpStatus.OK);
			const body = response.body as RoomTagsResponse;
			const klasse = body.tags.find((tag) => tag.name === 'Klasse 7a');
			expect(body.tagIds).toEqual([physik.id, klasse?.id]);
			expect(body.tags.map((tag) => tag.name)).toEqual(['Mathe', 'Physik', 'Klasse 7a']);
		});

		it('should sanitize the names', async () => {
			const { loggedInClient, rooms } = await setup();

			const response = await loggedInClient.put(`${rooms[0].id}/tags`, { names: ['<b>Bio</b><script>x</script>'] });

			const body = response.body as RoomTagsResponse;
			expect(body.tags.map((tag) => tag.name)).toContain('Bio');
		});

		it('should return a 400 error for a name that is too long', async () => {
			const { loggedInClient, rooms } = await setup();

			const response = await loggedInClient.put(`${rooms[0].id}/tags`, { names: ['x'.repeat(51)] });

			expect(response.status).toBe(HttpStatus.BAD_REQUEST);
		});

		it('should return a 403 error for a room the user is not a member of', async () => {
			const { loggedInClient, otherRoom } = await setup();

			const response = await loggedInClient.put(`${otherRoom.id}/tags`, { names: ['Mathe'] });

			expect(response.status).toBe(HttpStatus.FORBIDDEN);
		});
	});

	describe('PATCH /rooms/tags/:tagId', () => {
		it('should rename the tag', async () => {
			const { loggedInClient, findArrangement } = await setup();

			const response = await loggedInClient.patch(`tags/${physik.id}`, { name: 'Naturwissenschaften' });

			expect(response.status).toBe(HttpStatus.NO_CONTENT);
			const arrangement = await findArrangement();
			expect(
				arrangement.tags?.map(({ id, name }) => {
					return { id, name };
				})
			).toEqual([mathe, { id: physik.id, name: 'Naturwissenschaften' }]);
		});

		it('should merge with a tag of the same name', async () => {
			const { loggedInClient, findArrangement } = await setup();

			await loggedInClient.patch(`tags/${physik.id}`, { name: 'MATHE' });

			const arrangement = await findArrangement();
			expect(arrangement.tags?.map(({ id }) => id)).toEqual([mathe.id]);
			expect(arrangement.items.map((item) => item.tagIds)).toEqual([[mathe.id], [mathe.id]]);
		});

		it('should return a 404 error for an unknown tag', async () => {
			const { loggedInClient } = await setup();

			const response = await loggedInClient.patch(`tags/${new ObjectId().toHexString()}`, { name: 'Bio' });

			expect(response.status).toBe(HttpStatus.NOT_FOUND);
		});
	});

	describe('DELETE /rooms/tags/:tagId', () => {
		it('should remove the tag and keep the rooms', async () => {
			const { loggedInClient, rooms, findArrangement } = await setup();

			const response = await loggedInClient.delete(`tags/${mathe.id}`);

			expect(response.status).toBe(HttpStatus.NO_CONTENT);
			const arrangement = await findArrangement();
			expect(arrangement.tags?.map(({ id }) => id)).toEqual([physik.id]);
			expect(arrangement.items.map((item) => item.id)).toEqual(rooms.map((room) => room.id));
		});
	});
});
