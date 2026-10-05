import { EntityManager } from '@mikro-orm/mongodb';
import { FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import { BoardExternalReferenceType, BoardLayout, BoardNodeType } from '@modules/board';
import { BoardNodeEntity } from '@modules/board/repo/entity/board-node.entity';
import { columnBoardEntityFactory, learningPathStepEntityFactory } from '@modules/board/testing';
import { type CopyStatus } from '@modules/copy-helper';
import { GroupEntityTypes } from '@modules/group/entity/group.entity';
import { groupEntityFactory } from '@modules/group/testing';
import { roomMembershipEntityFactory } from '@modules/room-membership/testing';
import { ROOM_PUBLIC_API_CONFIG_TOKEN, type RoomPublicApiConfig } from '@modules/room/room.config';
import { RoomRolesTestFactory } from '@modules/room/testing/room-roles.test.factory';
import { schoolEntityFactory } from '@modules/school/testing';
import { ServerTestModule } from '@modules/server';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import { TestApiClient } from '@testing/test-api-client';
import { roomEntityFactory } from '../../testing/room-entity.factory';

// In a copied room, the learning path must lead through the copied boards.
describe('POST /rooms/:roomId/copy with a learning path', () => {
	let app: INestApplication;
	let em: EntityManager;
	let testApiClient: TestApiClient;

	beforeAll(async () => {
		const moduleFixture = await Test.createTestingModule({ imports: [ServerTestModule] })
			.overrideProvider(FilesStorageClientAdapterService)
			.useValue({
				copyFilesOfParent: jest.fn().mockResolvedValue([]),
				deleteFilesOfParent: jest.fn().mockResolvedValue([]),
			})
			.compile();

		app = moduleFixture.createNestApplication();
		await app.init();
		em = app.get(EntityManager);
		testApiClient = new TestApiClient(app, 'rooms');
		moduleFixture.get<RoomPublicApiConfig>(ROOM_PUBLIC_API_CONFIG_TOKEN).featureRoomCopyEnabled = true;
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	afterAll(async () => {
		await app.close();
	});

	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher({ school });
		const room = roomEntityFactory.build({ name: 'Physik', schoolId: school.id });
		const { roomOwnerRole } = RoomRolesTestFactory.createRoomRoles();
		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [{ role: roomOwnerRole, user: teacherUser }],
		});
		const roomMembership = roomMembershipEntityFactory.build({
			roomId: room.id,
			userGroupId: userGroup.id,
			schoolId: school.id,
		});

		const context = { id: room.id, type: BoardExternalReferenceType.Room };
		const pathBoard = columnBoardEntityFactory.build({ title: 'Lernweg', layout: BoardLayout.LEARNING_PATH, context });
		const boardA = columnBoardEntityFactory.build({ title: 'A', context });
		const boardB = columnBoardEntityFactory.build({ title: 'B', context });
		const stepA = learningPathStepEntityFactory.withParent(pathBoard).build({ linkedBoardId: boardA.id });
		const stepB = learningPathStepEntityFactory.withParent(pathBoard).build({
			linkedBoardId: boardB.id,
			prerequisiteStepIds: [stepA.id],
			lockUntilPrerequisitesDone: true,
		});

		await em
			.persist([
				school,
				room,
				roomOwnerRole,
				teacherAccount,
				teacherUser,
				userGroup,
				roomMembership,
				pathBoard,
				boardA,
				boardB,
				stepA,
				stepB,
			])
			.flush();
		em.clear();

		const loggedInClient = await testApiClient.login(teacherAccount);

		return { loggedInClient, room, originalIds: [pathBoard.id, boardA.id, boardB.id, stepA.id, stepB.id] };
	};

	it('should link the copied boards and keep the arrows between the copied steps', async () => {
		const { loggedInClient, room, originalIds } = await setup();

		const response = await loggedInClient.post(`${room.id}/copy`);
		expect(response.status).toBe(HttpStatus.CREATED);
		const copiedRoomId = (response.body as CopyStatus).id as string;

		em.clear();
		const copies = await em.find(BoardNodeEntity, { id: { $nin: originalIds } });
		const copiedBoardA = copies.find((node) => node.title === 'A');
		const copiedBoardB = copies.find((node) => node.title === 'B');
		const copiedSteps = copies.filter((node) => node.type === BoardNodeType.LEARNING_PATH_STEP);
		const copiedStepA = copiedSteps.find((step) => step.linkedBoardId === copiedBoardA?.id);
		const copiedStepB = copiedSteps.find((step) => step.linkedBoardId === copiedBoardB?.id);

		expect(copiedBoardA?.context?.id).toEqual(copiedRoomId);
		expect(copiedSteps).toHaveLength(2);
		expect(copiedStepA).toBeDefined();
		expect(copiedStepB?.prerequisiteStepIds).toEqual([copiedStepA?.id]);
		expect(copiedStepB?.lockUntilPrerequisitesDone).toBe(true);
	});
});
