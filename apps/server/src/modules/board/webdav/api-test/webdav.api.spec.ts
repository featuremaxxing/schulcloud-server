/* eslint-disable no-process-env */
import { EntityManager } from '@mikro-orm/mongodb';
import { AppPasswordService } from '@modules/app-password';
import { courseEntityFactory } from '@modules/course/testing';
import { GroupEntityTypes } from '@modules/group/entity';
import { groupEntityFactory } from '@modules/group/testing';
import { roomMembershipEntityFactory } from '@modules/room-membership/testing';
import { roomEntityFactory } from '@modules/room/testing';
import { RoomRolesTestFactory } from '@modules/room/testing/room-roles.test.factory';
import { ServerTestModule } from '@modules/server/server.app.module';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import SuperTest from 'supertest/lib/test';
import { BoardExternalReferenceType, BoardLayout, BoardNodeType } from '../../domain';
import { BoardNodeEntity } from '../../repo';
import { columnBoardEntityFactory, fileAreaFolderEntityFactory } from '../../testing';
import { createWebDavPreMiddleware } from '../webdav-pre.middleware';
import { WEBDAV_ROUTE } from '../webdav.constants';
import { WebDavFilesStorageClient } from '../webdav-files-storage.client';
import { FakeFilesStorage } from './fake-files-storage';

describe('webdav drive (api)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let appPasswordService: AppPasswordService;
	const filesStorage = new FakeFilesStorage();

	beforeAll(async () => {
		process.env.FEATURE_WEBDAV_ENABLED = 'true';

		const module: TestingModule = await Test.createTestingModule({ imports: [ServerTestModule] })
			.overrideProvider(WebDavFilesStorageClient)
			.useValue(filesStorage)
			.compile();

		app = module.createNestApplication();
		// as in apps/server.app.ts: in front of the body parsers NestJS registers on init
		app.use(createWebDavPreMiddleware(WEBDAV_ROUTE));
		await app.init();
		em = module.get(EntityManager);
		appPasswordService = module.get(AppPasswordService);
	});

	afterAll(async () => {
		await app.close();
		delete process.env.FEATURE_WEBDAV_ENABLED;
	});

	beforeEach(async () => {
		await cleanupCollections(em);
		filesStorage.files.clear();
	});

	const dav = (method: string, path: string, token?: string): SuperTest => {
		const test = new SuperTest(app.getHttpServer() as Server, method, path);
		if (token) {
			void test.auth('someone@example.com', token);
		}

		return test;
	};

	const areaPath = '/webdav/Physik/Dateien';

	const setup = async () => {
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const { studentAccount, studentUser } = UserAndAccountTestFactory.buildStudent({ school: teacherUser.school });
		// a room without an owner is locked, see BoardNodeAuthorizable.boardConfiguration.isLocked
		const { roomOwnerRole, roomEditorRole, roomViewerRole } = RoomRolesTestFactory.createRoomRoles();
		const { teacherUser: owner } = UserAndAccountTestFactory.buildTeacher({ school: teacherUser.school });

		const room = roomEntityFactory.buildWithId({ name: 'Physik', schoolId: teacherUser.school.id });
		const emptyRoom = roomEntityFactory.buildWithId({ name: 'Ohne Datei-Bereich', schoolId: teacherUser.school.id });
		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [
				{ user: owner, role: roomOwnerRole },
				{ user: teacherUser, role: roomEditorRole },
				{ user: studentUser, role: roomViewerRole },
			],
			organization: teacherUser.school,
		});
		const emptyRoomGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [
				{ user: owner, role: roomOwnerRole },
				{ user: teacherUser, role: roomEditorRole },
			],
			organization: teacherUser.school,
		});
		const roomMembership = roomMembershipEntityFactory.build({ roomId: room.id, userGroupId: userGroup.id });
		const emptyRoomMembership = roomMembershipEntityFactory.build({
			roomId: emptyRoom.id,
			userGroupId: emptyRoomGroup.id,
		});
		const course = courseEntityFactory.build({ name: 'Mathe 7b', school: teacherUser.school, teachers: [teacherUser] });

		await em
			.persist([
				teacherUser,
				teacherAccount,
				studentUser,
				studentAccount,
				owner,
				roomOwnerRole,
				roomEditorRole,
				roomViewerRole,
				room,
				emptyRoom,
				userGroup,
				emptyRoomGroup,
				roomMembership,
				emptyRoomMembership,
				course,
				teacherUser.school,
			])
			.flush();

		const board = columnBoardEntityFactory.build({
			title: 'Dateien',
			layout: BoardLayout.FILES,
			context: { id: room.id, type: BoardExternalReferenceType.Room },
			isVisible: true,
		});
		const normalBoard = columnBoardEntityFactory.build({
			title: 'Unterricht',
			layout: BoardLayout.COLUMNS,
			context: { id: room.id, type: BoardExternalReferenceType.Room },
			isVisible: true,
		});
		const normalBoardInEmptyRoom = columnBoardEntityFactory.build({
			title: 'Nur Karten',
			context: { id: emptyRoom.id, type: BoardExternalReferenceType.Room },
		});
		const courseBoard = columnBoardEntityFactory.build({
			title: 'Brüche',
			context: { id: course.id, type: BoardExternalReferenceType.Course },
		});
		const folderA = fileAreaFolderEntityFactory.withParent(board).build({ title: 'A' });
		const folderB = fileAreaFolderEntityFactory.withParent(folderA).build({ title: 'B' });
		const folderC = fileAreaFolderEntityFactory.withParent(board).build({ title: 'C' });
		await em.persist([board, normalBoard, normalBoardInEmptyRoom, courseBoard, folderA, folderB, folderC]).flush();
		em.clear();

		const { token: teacherToken } = await appPasswordService.create(teacherUser.id, 'test');
		const { token: studentToken } = await appPasswordService.create(studentUser.id, 'test');

		return { teacherToken, studentToken, board, folderA, folderB, folderC };
	};

	const folders = (): Promise<BoardNodeEntity[]> => {
		em.clear();

		return em.find(BoardNodeEntity, { type: BoardNodeType.FILE_AREA_FOLDER });
	};

	describe('authentication', () => {
		it('should answer OPTIONS without credentials and advertise locking', async () => {
			const response = await dav('OPTIONS', '/webdav/');

			expect(response.status).toEqual(HttpStatus.OK);
			expect(response.headers.dav).toEqual('1, 2');
		});

		it('should ask for basic auth without or with a wrong app password', async () => {
			const { teacherToken } = await setup();

			const withoutAuth = await dav('PROPFIND', '/webdav/');
			const wrongSecret = await dav('PROPFIND', '/webdav/', `${teacherToken.split('.')[0]}.wrong`);

			expect(withoutAuth.status).toEqual(HttpStatus.UNAUTHORIZED);
			expect(withoutAuth.headers['www-authenticate']).toContain('Basic');
			expect(wrongSecret.status).toEqual(HttpStatus.UNAUTHORIZED);
		});
	});

	describe('browsing', () => {
		it('should only show rooms with file areas and only their file areas', async () => {
			const { teacherToken } = await setup();

			const root = await dav('PROPFIND', '/webdav/', teacherToken).set('Depth', '1');
			const room = await dav('PROPFIND', '/webdav/Physik/', teacherToken).set('Depth', '1');

			expect(root.status).toEqual(207);
			expect(root.text).toContain('<D:displayname>Physik</D:displayname>');
			expect(root.text).not.toContain('Ohne Datei-Bereich');
			expect(root.text).not.toContain('Kurse');
			expect(root.text).not.toContain('Mathe 7b');
			expect(room.text).toContain('<D:displayname>Dateien</D:displayname>');
			expect(room.text).not.toContain('Unterricht');
		});

		it('should show folders and files at any depth', async () => {
			const { teacherToken, board, folderA } = await setup();
			await filesStorage.upload('', '', board.id, 'top.txt', Readable.from(Buffer.from('top')));
			await filesStorage.upload('', '', folderA.id, 'in-a.txt', Readable.from(Buffer.from('a')));

			const top = await dav('PROPFIND', `${areaPath}/`, teacherToken).set('Depth', '1');
			const inA = await dav('PROPFIND', `${areaPath}/A/`, teacherToken).set('Depth', '1');
			const inB = await dav('PROPFIND', `${areaPath}/A/B/`, teacherToken).set('Depth', '1');

			expect(top.text).toContain('<D:displayname>A</D:displayname>');
			expect(top.text).toContain('<D:displayname>C</D:displayname>');
			expect(top.text).toContain('<D:displayname>top.txt</D:displayname>');
			expect(inA.text).toContain('<D:displayname>B</D:displayname>');
			expect(inA.text).toContain('<D:displayname>in-a.txt</D:displayname>');
			expect(inB.status).toEqual(207);
		});

		it('should refuse infinite depth and answer 404 for unknown paths', async () => {
			const { teacherToken } = await setup();

			const infinite = await dav('PROPFIND', '/webdav/', teacherToken).set('Depth', 'infinity');
			const unknown = await dav('PROPFIND', '/webdav/Physik/Unterricht/', teacherToken);

			expect(infinite.status).toEqual(HttpStatus.FORBIDDEN);
			expect(unknown.status).toEqual(HttpStatus.NOT_FOUND);
		});
	});

	describe('files', () => {
		it('should store files in the file area and in folders and serve them back', async () => {
			const { teacherToken, board, folderB } = await setup();

			const onBoard = await dav('PUT', `${areaPath}/lose.txt`, teacherToken).send('Hallo Welt');
			const inFolder = await dav('PUT', `${areaPath}/A/B/tief.txt`, teacherToken).send('y');
			const get = await dav('GET', `${areaPath}/lose.txt`, teacherToken);

			expect([onBoard.status, inFolder.status]).toEqual([HttpStatus.CREATED, HttpStatus.CREATED]);
			expect(get.text).toEqual('Hallo Welt');
			const parents = [...filesStorage.files.values()].map((file) => [file.record.name, file.record.parentId]);
			expect(parents).toEqual(
				expect.arrayContaining([
					['lose.txt', board.id],
					['tief.txt', folderB.id],
				])
			);
		});

		it('should replace the content of an existing file under the same name', async () => {
			const { teacherToken } = await setup();
			await dav('PUT', `${areaPath}/notizen.txt`, teacherToken).send('alt');

			const replace = await dav('PUT', `${areaPath}/notizen.txt`, teacherToken).send('neu');
			const get = await dav('GET', `${areaPath}/notizen.txt`, teacherToken);

			expect(replace.status).toEqual(HttpStatus.NO_CONTENT);
			expect(get.text).toEqual('neu');
			expect(filesStorage.files.size).toEqual(1);
		});

		it('should rename, move and delete files', async () => {
			const { teacherToken, folderC } = await setup();
			await dav('PUT', `${areaPath}/A/a.txt`, teacherToken).send('x');
			const [originalId] = [...filesStorage.files.keys()];

			const rename = await dav('MOVE', `${areaPath}/A/a.txt`, teacherToken).set('Destination', `${areaPath}/A/b.txt`);
			const move = await dav('MOVE', `${areaPath}/A/b.txt`, teacherToken).set('Destination', `${areaPath}/C/b.txt`);

			expect([rename.status, move.status]).toEqual([HttpStatus.CREATED, HttpStatus.CREATED]);
			expect([...filesStorage.files.values()].map((file) => [file.record.name, file.record.parentId])).toEqual([
				['b.txt', folderC.id],
			]);
			// moved, not copied: the file keeps its id, so links to it stay valid
			expect([...filesStorage.files.keys()]).toEqual([originalId]);

			const deleted = await dav('DELETE', `${areaPath}/C/b.txt`, teacherToken);
			expect(deleted.status).toEqual(HttpStatus.NO_CONTENT);
			expect(filesStorage.files.size).toEqual(0);
		});

		it('should not store files in rooms or at the root', async () => {
			const { teacherToken } = await setup();

			const inRoom = await dav('PUT', '/webdav/Physik/x.txt', teacherToken).send('x');
			const atRoot = await dav('PUT', '/webdav/x.txt', teacherToken).send('x');

			expect([inRoom.status, atRoot.status]).toEqual([HttpStatus.FORBIDDEN, HttpStatus.FORBIDDEN]);
		});

		it('should keep system files readable without storing them', async () => {
			const { teacherToken } = await setup();

			const put = await dav('PUT', `${areaPath}/._notizen.txt`, teacherToken).send('metadata');
			const get = await dav('GET', `${areaPath}/._notizen.txt`, teacherToken);
			const listing = await dav('PROPFIND', `${areaPath}/`, teacherToken).set('Depth', '1');
			const deleted = await dav('DELETE', `${areaPath}/._notizen.txt`, teacherToken);

			expect(put.status).toEqual(HttpStatus.CREATED);
			expect(Buffer.from(get.body as Buffer).toString()).toEqual('metadata');
			expect(listing.text).not.toContain('._notizen.txt');
			expect(deleted.status).toEqual(HttpStatus.NO_CONTENT);
			expect(filesStorage.files.size).toEqual(0);
		});

		it('should support the Finder write sequence (LOCK, empty PUT, PUT, metadata, UNLOCK)', async () => {
			const { teacherToken } = await setup();
			const lockBody =
				'<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>finder</D:href></D:owner></D:lockinfo>';

			const lockNew = await dav('LOCK', `${areaPath}/bericht.txt`, teacherToken)
				.set('Content-Type', 'text/xml')
				.send(lockBody);
			const placeholder = await dav('PROPFIND', `${areaPath}/bericht.txt`, teacherToken).set('Depth', '0');
			const emptyPut = await dav('PUT', `${areaPath}/bericht.txt`, teacherToken).set('Content-Length', '0');
			const contentPut = await dav('PUT', `${areaPath}/bericht.txt`, teacherToken)
				.set('If', `(${String(lockNew.headers['lock-token'])})`)
				.send('Inhalt');
			const metadata = await dav('PUT', `${areaPath}/._bericht.txt`, teacherToken).send('meta');
			const unlock = await dav('UNLOCK', `${areaPath}/bericht.txt`, teacherToken).set(
				'Lock-Token',
				String(lockNew.headers['lock-token'])
			);
			const get = await dav('GET', `${areaPath}/bericht.txt`, teacherToken);

			expect(lockNew.status).toEqual(HttpStatus.CREATED);
			expect(placeholder.status).toEqual(207);
			expect([emptyPut.status, contentPut.status]).toEqual([HttpStatus.CREATED, HttpStatus.NO_CONTENT]);
			expect([metadata.status, unlock.status]).toEqual([201, 204]);
			expect(get.text).toEqual('Inhalt');
			expect(filesStorage.files.size).toEqual(1);
		});

		it('should not overwrite JSON content with the body parser', async () => {
			const { teacherToken } = await setup();
			const json = '{ "a" :   1 }';

			await dav('PUT', `${areaPath}/daten.json`, teacherToken).set('Content-Type', 'application/json').send(json);
			const get = await dav('GET', `${areaPath}/daten.json`, teacherToken);

			expect(get.text).toEqual(json);
		});
	});

	describe('folders', () => {
		it('should create nested folders with MKCOL', async () => {
			const { teacherToken, folderB } = await setup();

			const top = await dav('MKCOL', `${areaPath}/Neu`, teacherToken);
			const nested = await dav('MKCOL', `${areaPath}/A/B/Tief`, teacherToken);
			const inRoom = await dav('MKCOL', '/webdav/Physik/Neuer%20Bereich', teacherToken);

			expect([top.status, nested.status, inRoom.status]).toEqual([201, 201, 403]);
			const created = (await folders()).find((node) => node.title === 'Tief');
			expect(created?.path).toContain(folderB.id);
		});

		it('should move and rename folders', async () => {
			const { teacherToken, folderB, folderC } = await setup();

			const move = await dav('MOVE', `${areaPath}/C`, teacherToken).set('Destination', `${areaPath}/A/B/C`);
			const rename = await dav('MOVE', `${areaPath}/A/B`, teacherToken).set('Destination', `${areaPath}/A/Bee`);

			expect([move.status, rename.status]).toEqual([HttpStatus.CREATED, HttpStatus.CREATED]);
			const all = await folders();
			expect(all.find((node) => node.id === folderC.id)?.path).toContain(folderB.id);
			expect(all.find((node) => node.id === folderB.id)?.title).toEqual('Bee');
		});

		it('should refuse to move a folder into itself', async () => {
			const { teacherToken } = await setup();

			const response = await dav('MOVE', `${areaPath}/A`, teacherToken).set('Destination', `${areaPath}/A/B/A`);

			expect(response.status).toEqual(HttpStatus.BAD_REQUEST);
		});

		it('should delete folders with their subfolders but never a file area', async () => {
			const { teacherToken, folderC } = await setup();

			const deleted = await dav('DELETE', `${areaPath}/A`, teacherToken);
			const area = await dav('DELETE', `${areaPath}/`, teacherToken);

			expect([deleted.status, area.status]).toEqual([HttpStatus.NO_CONTENT, HttpStatus.FORBIDDEN]);
			expect((await folders()).map((node) => node.id)).toEqual([folderC.id]);
		});
	});

	describe('as a student', () => {
		// the drive is for teachers only (see canUseAppPasswords); a student may still hold an
		// app password created before, it must not open the drive
		it('should refuse every request, including reading', async () => {
			const { studentToken } = await setup();

			const root = await dav('PROPFIND', '/webdav/', studentToken).set('Depth', '1');
			const read = await dav('PROPFIND', `${areaPath}/`, studentToken).set('Depth', '1');
			const put = await dav('PUT', `${areaPath}/x.txt`, studentToken).send('x');

			expect([root.status, read.status, put.status]).toEqual([403, 403, 403]);
		});
	});
});
