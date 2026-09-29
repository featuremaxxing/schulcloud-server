import { EntityManager } from '@mikro-orm/mongodb';
import { accountFactory } from '@modules/account/testing';
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
import { BoardExternalReferenceType, BoardLayout } from '../../domain';
import { BoardNodeEntity } from '../../repo';
import { columnBoardEntityFactory } from '../../testing';
import { fileAreaFolderEntityFactory } from '../../testing/entity';

type FolderJson = { id: string; parentId: string; title: string };

describe('file area (api)', () => {
	let app: INestApplication;
	let em: EntityManager;

	beforeAll(async () => {
		const module: TestingModule = await Test.createTestingModule({ imports: [ServerTestModule] }).compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const editor = userFactory.buildWithId({ school });
		const viewer = userFactory.buildWithId({ school });
		const outsider = userFactory.buildWithId({ school });
		const editorAccount = accountFactory.withUser(editor).build();
		const viewerAccount = accountFactory.withUser(viewer).build();
		const outsiderAccount = accountFactory.withUser(outsider).build();

		const { roomEditorRole, roomViewerRole, roomOwnerRole } = RoomRolesTestFactory.createRoomRoles();
		const owner = userFactory.buildWithId({ school });
		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [
				{ user: owner, role: roomOwnerRole },
				{ user: editor, role: roomEditorRole },
				{ user: viewer, role: roomViewerRole },
			],
			organization: school,
		});
		const room = roomEntityFactory.buildWithId({ schoolId: school.id });
		const roomMembership = roomMembershipEntityFactory.build({ roomId: room.id, userGroupId: userGroup.id });

		const board = columnBoardEntityFactory.build({
			layout: BoardLayout.FILES,
			isVisible: true,
			context: { id: room.id, type: BoardExternalReferenceType.Room },
		});
		const normalBoard = columnBoardEntityFactory.build({
			layout: BoardLayout.COLUMNS,
			context: { id: room.id, type: BoardExternalReferenceType.Room },
		});
		const parent = fileAreaFolderEntityFactory.withParent(board).build({ title: 'Parent' });
		const child = fileAreaFolderEntityFactory.withParent(parent).build({ title: 'Child' });

		await em
			.persist([
				editorAccount,
				viewerAccount,
				outsiderAccount,
				editor,
				viewer,
				outsider,
				roomEditorRole,
				roomViewerRole,
				userGroup,
				room,
				roomMembership,
				school,
				board,
				normalBoard,
				parent,
				child,
			])
			.flush();
		em.clear();

		const clientFor = (account: typeof editorAccount) => new TestApiClientBuilder(app, '').build(account);

		return { clientFor, editorAccount, viewerAccount, outsiderAccount, board, normalBoard, parent, child, room };
	};

	describe('GET /boards/:boardId/file-area/folders', () => {
		it('should return all folders as a flat list', async () => {
			const { clientFor, editorAccount, board, parent, child } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.get(`boards/${board.id}/file-area/folders`);

			expect(response.status).toEqual(200);
			const body = response.body as { folders: FolderJson[]; allowedOperations: Record<string, boolean> };
			expect(body.folders.map((f) => [f.id, f.parentId, f.title])).toEqual(
				expect.arrayContaining([
					[parent.id, board.id, 'Parent'],
					[child.id, parent.id, 'Child'],
				])
			);
			expect(body.allowedOperations.createElement).toBe(true);
		});

		it('should allow viewers to read but not to edit', async () => {
			const { clientFor, viewerAccount, board } = await setup();
			const client = await clientFor(viewerAccount);

			const response = await client.get(`boards/${board.id}/file-area/folders`);

			expect(response.status).toEqual(200);
			expect((response.body as { allowedOperations: Record<string, boolean> }).allowedOperations.createElement).toBe(
				false
			);
		});

		it('should return 403 for users outside of the room', async () => {
			const { clientFor, outsiderAccount, board } = await setup();
			const client = await clientFor(outsiderAccount);

			const response = await client.get(`boards/${board.id}/file-area/folders`);

			expect(response.status).toEqual(403);
		});

		it('should return 404 for a board that is not a file area', async () => {
			const { clientFor, editorAccount, normalBoard } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.get(`boards/${normalBoard.id}/file-area/folders`);

			expect(response.status).toEqual(404);
		});
	});

	describe('POST /file-area-folders', () => {
		it('should create a folder on the top level and nested', async () => {
			const { clientFor, editorAccount, board, child } = await setup();
			const client = await clientFor(editorAccount);

			const top = await client.post('file-area-folders', { parentId: board.id, title: 'Top' });
			const nested = await client.post('file-area-folders', { parentId: child.id, title: 'Level 3' });

			expect(top.status).toEqual(201);
			expect(nested.status).toEqual(201);
			const stored = await em.findOneOrFail(BoardNodeEntity, (nested.body as FolderJson).id);
			expect(stored.path).toContain(child.id);
			expect(stored.level).toEqual(3);
		});

		it('should make names unique among siblings', async () => {
			const { clientFor, editorAccount, board } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.post('file-area-folders', { parentId: board.id, title: 'parent' });

			expect((response.body as FolderJson).title).toEqual('parent (2)');
		});

		it('should return 403 for viewers', async () => {
			const { clientFor, viewerAccount, board } = await setup();
			const client = await clientFor(viewerAccount);

			const response = await client.post('file-area-folders', { parentId: board.id, title: 'x' });

			expect(response.status).toEqual(403);
		});

		it('should refuse a board that is not a file area as parent', async () => {
			const { clientFor, editorAccount, normalBoard } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.post('file-area-folders', { parentId: normalBoard.id, title: 'x' });

			expect(response.status).toEqual(400);
		});
	});

	describe('PATCH /file-area-folders/:id/title', () => {
		it('should rename the folder', async () => {
			const { clientFor, editorAccount, child } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.patch(`file-area-folders/${child.id}/title`, { title: 'Renamed' });

			expect(response.status).toEqual(200);
			expect((await em.findOneOrFail(BoardNodeEntity, child.id)).title).toEqual('Renamed');
		});

		it('should return 403 for viewers', async () => {
			const { clientFor, viewerAccount, child } = await setup();
			const client = await clientFor(viewerAccount);

			const response = await client.patch(`file-area-folders/${child.id}/title`, { title: 'Renamed' });

			expect(response.status).toEqual(403);
		});
	});

	describe('PUT /file-area-folders/:id/parent', () => {
		it('should move a folder to the top level', async () => {
			const { clientFor, editorAccount, board, child } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.put(`file-area-folders/${child.id}/parent`, { toParentId: board.id });

			expect(response.status).toEqual(200);
			const stored = await em.findOneOrFail(BoardNodeEntity, child.id);
			expect(stored.level).toEqual(1);
		});

		it('should refuse to move a folder into its own descendant', async () => {
			const { clientFor, editorAccount, parent, child } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.put(`file-area-folders/${parent.id}/parent`, { toParentId: child.id });

			expect(response.status).toEqual(400);
		});

		it('should refuse to move a folder into itself', async () => {
			const { clientFor, editorAccount, parent } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.put(`file-area-folders/${parent.id}/parent`, { toParentId: parent.id });

			expect(response.status).toEqual(400);
		});
	});

	describe('DELETE /file-area-folders/:id', () => {
		it('should delete the folder with its subfolders', async () => {
			const { clientFor, editorAccount, parent, child } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.delete(`file-area-folders/${parent.id}`);

			expect(response.status).toEqual(204);
			expect(await em.findOne(BoardNodeEntity, parent.id)).toBeNull();
			expect(await em.findOne(BoardNodeEntity, child.id)).toBeNull();
		});

		it('should return 403 for viewers', async () => {
			const { clientFor, viewerAccount, parent } = await setup();
			const client = await clientFor(viewerAccount);

			const response = await client.delete(`file-area-folders/${parent.id}`);

			expect(response.status).toEqual(403);
		});
	});

	describe('POST /boards/:boardId/file-area/files-changed', () => {
		it('should accept folders of the file area and the area itself', async () => {
			const { clientFor, editorAccount, board, child } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.post(`boards/${board.id}/file-area/files-changed`, {
				parentIds: [board.id, child.id],
			});

			expect(response.status).toEqual(204);
		});

		it('should refuse parents of another board', async () => {
			const { clientFor, editorAccount, board, normalBoard } = await setup();
			const client = await clientFor(editorAccount);

			const response = await client.post(`boards/${board.id}/file-area/files-changed`, {
				parentIds: [normalBoard.id],
			});

			expect(response.status).toEqual(400);
		});

		it('should return 403 for viewers', async () => {
			const { clientFor, viewerAccount, board } = await setup();
			const client = await clientFor(viewerAccount);

			const response = await client.post(`boards/${board.id}/file-area/files-changed`, { parentIds: [board.id] });

			expect(response.status).toEqual(403);
		});
	});
});
