/* eslint-disable no-process-env */
import { EntityManager } from '@mikro-orm/mongodb';
import { accountFactory } from '@modules/account/testing';
import { courseEntityFactory } from '@modules/course/testing';
import { GroupEntityTypes } from '@modules/group/entity';
import { groupEntityFactory } from '@modules/group/testing';
import { roomMembershipEntityFactory } from '@modules/room-membership/testing';
import { roomEntityFactory } from '@modules/room/testing';
import { RoomRolesTestFactory } from '@modules/room/testing/room-roles.test.factory';
import { schoolEntityFactory } from '@modules/school/testing';
import { ServerTestModule } from '@modules/server/server.app.module';
import { userFactory } from '@modules/user/testing';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { TestApiClientBuilder } from '@testing/test-api-client-builder';
import { BoardExternalReferenceType, BoardLayout, ContentElementType } from '../../domain';
import { BoardNodeEntity } from '../../repo';
import {
	cardEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
	fileAreaFolderEntityFactory,
} from '../../testing';

type ElementJson = {
	id: string;
	content: { fileAreaId?: string; targetType?: string; targetId?: string; title: string };
};

describe('file area link element (api)', () => {
	let app: INestApplication;
	let em: EntityManager;

	beforeAll(async () => {
		process.env.FEATURE_BOARD_FILE_AREA_ENABLED = 'true';
		const module: TestingModule = await Test.createTestingModule({ imports: [ServerTestModule] }).compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
	});

	afterAll(async () => {
		await app.close();
		delete process.env.FEATURE_BOARD_FILE_AREA_ENABLED;
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const owner = userFactory.buildWithId({ school });
		const editor = userFactory.buildWithId({ school });
		const editorAccount = accountFactory.withUser(editor).build();
		const { roomOwnerRole, roomEditorRole } = RoomRolesTestFactory.createRoomRoles();

		const room = roomEntityFactory.buildWithId({ schoolId: school.id });
		const otherRoom = roomEntityFactory.buildWithId({ schoolId: school.id });
		const groups = [room, otherRoom].map(() =>
			groupEntityFactory.buildWithId({
				type: GroupEntityTypes.ROOM,
				users: [
					{ user: owner, role: roomOwnerRole },
					{ user: editor, role: roomEditorRole },
				],
				organization: school,
			})
		);
		const memberships = [room, otherRoom].map((r, index) =>
			roomMembershipEntityFactory.build({ roomId: r.id, userGroupId: groups[index].id })
		);
		const course = courseEntityFactory.build({ school, teachers: [editor] });

		await em
			.persist([
				school,
				owner,
				editor,
				editorAccount,
				roomOwnerRole,
				roomEditorRole,
				room,
				otherRoom,
				...groups,
				...memberships,
				course,
			])
			.flush();

		const roomRef = { id: room.id, type: BoardExternalReferenceType.Room };
		const board = columnBoardEntityFactory.build({ context: roomRef });
		const column = columnEntityFactory.withParent(board).build();
		const card = cardEntityFactory.withParent(column).build();
		const fileArea = columnBoardEntityFactory.build({ title: 'Dateien', layout: BoardLayout.FILES, context: roomRef });
		const folder = fileAreaFolderEntityFactory.withParent(fileArea).build({ title: 'Arbeitsblätter' });
		const otherFileArea = columnBoardEntityFactory.build({
			layout: BoardLayout.FILES,
			context: { id: otherRoom.id, type: BoardExternalReferenceType.Room },
		});
		const courseBoard = columnBoardEntityFactory.build({
			context: { id: course.id, type: BoardExternalReferenceType.Course },
		});
		const courseColumn = columnEntityFactory.withParent(courseBoard).build();
		const courseCard = cardEntityFactory.withParent(courseColumn).build();

		await em
			.persist([board, column, card, fileArea, folder, otherFileArea, courseBoard, courseColumn, courseCard])
			.flush();
		em.clear();

		const client = await new TestApiClientBuilder(app, '').build(editorAccount);

		return { client, room, card, courseCard, fileArea, folder, otherFileArea };
	};

	const createElement = (client: Awaited<ReturnType<typeof setup>>['client'], cardId: string) =>
		client.post(`cards/${cardId}/elements`, { type: ContentElementType.FILE_AREA_LINK });

	it('should list the file areas of a room', async () => {
		const { client, room, fileArea } = await setup();

		const response = await client.get(`rooms/${room.id}/file-areas`);

		expect(response.status).toEqual(200);
		expect((response.body as { data: { id: string; title: string }[] }).data).toEqual([
			expect.objectContaining({ id: fileArea.id, title: 'Dateien' }),
		]);
	});

	it('should link a folder and take its name', async () => {
		const { client, card, fileArea, folder } = await setup();
		const created = await createElement(client, card.id);

		const response = await client.patch(`elements/${(created.body as ElementJson).id}/content`, {
			data: {
				type: ContentElementType.FILE_AREA_LINK,
				content: { fileAreaId: fileArea.id, targetType: 'folder', targetId: folder.id, title: 'egal' },
			},
		});

		expect(created.status).toEqual(201);
		expect(response.status).toEqual(200);
		expect((response.body as ElementJson).content).toEqual({
			fileAreaId: fileArea.id,
			targetType: 'folder',
			targetId: folder.id,
			title: 'Arbeitsblätter',
		});
		const stored = await em.findOneOrFail(BoardNodeEntity, (created.body as ElementJson).id);
		expect(stored.targetId).toEqual(folder.id);
	});

	it('should link a file with the given name', async () => {
		const { client, card, fileArea } = await setup();
		const created = await createElement(client, card.id);
		const fileId = '5f2987e020834114b8efd6f8';

		const response = await client.patch(`elements/${(created.body as ElementJson).id}/content`, {
			data: {
				type: ContentElementType.FILE_AREA_LINK,
				content: { fileAreaId: fileArea.id, targetType: 'file', targetId: fileId, title: 'aufgabe.pdf' },
			},
		});

		expect(response.status).toEqual(200);
		expect((response.body as ElementJson).content.title).toEqual('aufgabe.pdf');
	});

	it('should refuse a file area of another room', async () => {
		const { client, card, otherFileArea } = await setup();
		const created = await createElement(client, card.id);

		const response = await client.patch(`elements/${(created.body as ElementJson).id}/content`, {
			data: {
				type: ContentElementType.FILE_AREA_LINK,
				content: { fileAreaId: otherFileArea.id, targetType: 'file', targetId: otherFileArea.id, title: 'x' },
			},
		});

		expect(response.status).toEqual(400);
	});

	it('should refuse a folder of another file area', async () => {
		const { client, card, fileArea, otherFileArea } = await setup();
		const foreignFolder = fileAreaFolderEntityFactory
			.withParent(await em.findOneOrFail(BoardNodeEntity, otherFileArea.id))
			.build();
		await em.persist(foreignFolder).flush();
		const created = await createElement(client, card.id);

		const response = await client.patch(`elements/${(created.body as ElementJson).id}/content`, {
			data: {
				type: ContentElementType.FILE_AREA_LINK,
				content: { fileAreaId: fileArea.id, targetType: 'folder', targetId: foreignFolder.id, title: 'x' },
			},
		});

		expect(response.status).toEqual(400);
	});

	it('should not add the element to a course board', async () => {
		const { client, courseCard } = await setup();

		const response = await createElement(client, courseCard.id);

		expect(response.status).toEqual(400);
	});
});
