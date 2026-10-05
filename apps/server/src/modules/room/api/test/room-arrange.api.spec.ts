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

describe('Room Controller (API)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let testApiClient: TestApiClient;

	const collectionId = '0b6f1f7e-3d1c-4a63-9a43-6f7c2f1d9a10';

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

	describe('PUT /rooms/arrangement', () => {
		describe('when the user is not authenticated', () => {
			it('should return a 401 error', async () => {
				const response = await testApiClient.put('arrangement', { items: [], collections: [] });
				expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
			});
		});

		describe('when the user is authenticated', () => {
			const setup = async () => {
				const school = schoolEntityFactory.buildWithId();
				const rooms = roomEntityFactory.buildListWithId(3, { schoolId: school.id });
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
				const roomArrangement = roomArrangementEntityFactory.build({
					userId: teacherUser.id,
					items: rooms.map((room) => {
						return { id: room.id };
					}),
				});
				await em
					.persist([
						...rooms,
						teacherAccount,
						teacherUser,
						roomOwnerRole,
						userGroupEntity,
						...roomMemberships,
						roomArrangement,
					])
					.flush();
				em.clear();

				const loggedInClient = await testApiClient.login(teacherAccount);

				const findArrangement = () => em.findOneOrFail(RoomArrangementEntity, { userId: teacherUser.id });

				return { loggedInClient, rooms, findArrangement };
			};

			it('should store order and collections', async () => {
				const { loggedInClient, rooms, findArrangement } = await setup();

				const response = await loggedInClient.put('arrangement', {
					items: [{ id: rooms[2].id }, { id: rooms[0].id, collectionId }, { id: rooms[1].id, collectionId }],
					collections: [{ id: collectionId, title: 'Mathe' }],
				});

				expect(response.status).toBe(HttpStatus.NO_CONTENT);
				const arrangement = await findArrangement();
				expect(arrangement.items.map((item) => [item.id, item.collectionId ?? undefined])).toEqual([
					[rooms[2].id, undefined],
					[rooms[0].id, collectionId],
					[rooms[1].id, collectionId],
				]);
				expect(
					arrangement.collections?.map(({ id, title }) => {
						return { id, title };
					})
				).toEqual([{ id: collectionId, title: 'Mathe' }]);
			});

			it('should return the collections with the room list', async () => {
				const { loggedInClient, rooms } = await setup();

				await loggedInClient.put('arrangement', {
					items: rooms.map((room) => {
						return { id: room.id, collectionId };
					}),
					collections: [{ id: collectionId, title: 'Mathe' }],
				});
				const response = await loggedInClient.get();

				expect(response.body).toMatchObject({
					collections: [{ id: collectionId, title: 'Mathe' }],
					data: rooms.map((room) => {
						return { id: room.id, collectionId };
					}),
				});
			});

			it('should ignore rooms that are not in the arrangement of the user', async () => {
				const { loggedInClient, rooms, findArrangement } = await setup();
				const foreignRoomId = new ObjectId().toHexString();

				await loggedInClient.put('arrangement', {
					items: [
						{ id: foreignRoomId },
						...rooms.map((room) => {
							return { id: room.id };
						}),
					],
					collections: [],
				});

				const arrangement = await findArrangement();
				expect(arrangement.items.map((item) => item.id)).toEqual(rooms.map((room) => room.id));
			});

			it('should keep rooms the client did not send at the end', async () => {
				const { loggedInClient, rooms, findArrangement } = await setup();

				await loggedInClient.put('arrangement', { items: [{ id: rooms[2].id }], collections: [] });

				const arrangement = await findArrangement();
				expect(arrangement.items.map((item) => item.id)).toEqual([rooms[2].id, rooms[0].id, rooms[1].id]);
			});

			it('should drop collections without rooms and unknown collection ids', async () => {
				const { loggedInClient, rooms, findArrangement } = await setup();
				const unknownCollectionId = '7d1a5c2e-8b9f-4e3a-b1c2-d3e4f5a6b7c8';

				await loggedInClient.put('arrangement', {
					items: [{ id: rooms[0].id, collectionId: unknownCollectionId }, { id: rooms[1].id }, { id: rooms[2].id }],
					collections: [{ id: collectionId, title: 'Leer' }],
				});

				const arrangement = await findArrangement();
				expect(arrangement.items.every((item) => !item.collectionId)).toBe(true);
				expect(arrangement.collections).toEqual([]);
			});

			it('should sanitize the collection title', async () => {
				const { loggedInClient, rooms, findArrangement } = await setup();

				await loggedInClient.put('arrangement', {
					items: [{ id: rooms[0].id, collectionId }],
					collections: [{ id: collectionId, title: '<b>Mathe</b><script>alert(1)</script>' }],
				});

				const arrangement = await findArrangement();
				expect(arrangement.collections?.[0].title).toBe('Mathe');
			});

			describe('when the body is invalid', () => {
				it('should return a 400 error for a collection id that is not a uuid', async () => {
					const { loggedInClient, rooms } = await setup();

					const response = await loggedInClient.put('arrangement', {
						items: [{ id: rooms[0].id, collectionId: 'abc' }],
						collections: [{ id: 'abc', title: 'Mathe' }],
					});

					expect(response.status).toBe(HttpStatus.BAD_REQUEST);
				});

				it('should return a 400 error for a title that is too long', async () => {
					const { loggedInClient, rooms } = await setup();

					const response = await loggedInClient.put('arrangement', {
						items: [{ id: rooms[0].id, collectionId }],
						collections: [{ id: collectionId, title: 'x'.repeat(101) }],
					});

					expect(response.status).toBe(HttpStatus.BAD_REQUEST);
				});
			});
		});
	});
});
