/* eslint-disable no-process-env */
import { EntityManager } from '@mikro-orm/mongodb';
import { AppPasswordService } from '@modules/app-password';
import { courseEntityFactory } from '@modules/course/testing';
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
import { columnBoardEntityFactory } from '../../testing';
import { fileAreaFolderEntityFactory } from '../../testing/entity';
import { createWebDavPreMiddleware } from '../webdav-pre.middleware';
import { WEBDAV_ROUTE } from '../webdav.constants';
import { WebDavFilesStorageClient } from '../webdav-files-storage.client';
import { FakeFilesStorage } from './fake-files-storage';

describe('webdav drive for file areas (api)', () => {
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

	const areaPath = '/webdav/Kurse/Mathe%207b/Dateien';

	const setup = async () => {
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const course = courseEntityFactory.build({ name: 'Mathe 7b', school: teacherUser.school, teachers: [teacherUser] });
		await em.persist([teacherUser, teacherAccount, course]).flush();

		const board = columnBoardEntityFactory.build({
			title: 'Dateien',
			layout: BoardLayout.FILES,
			context: { id: course.id, type: BoardExternalReferenceType.Course },
			isVisible: true,
		});
		const folderA = fileAreaFolderEntityFactory.withParent(board).build({ title: 'A' });
		const folderB = fileAreaFolderEntityFactory.withParent(folderA).build({ title: 'B' });
		const folderC = fileAreaFolderEntityFactory.withParent(board).build({ title: 'C' });
		await em.persist([board, folderA, folderB, folderC]).flush();
		em.clear();

		const { token } = await appPasswordService.create(teacherUser.id, 'test');

		return { token, board, folderA, folderB, folderC };
	};

	const folders = (): Promise<BoardNodeEntity[]> => {
		em.clear();

		return em.find(BoardNodeEntity, { type: BoardNodeType.FILE_AREA_FOLDER });
	};

	it('should show folders and files at any depth without columns and cards', async () => {
		const { token, board, folderA } = await setup();
		await filesStorage.upload('', '', board.id, 'top.txt', Readable.from(Buffer.from('top')));
		await filesStorage.upload('', '', folderA.id, 'in-a.txt', Readable.from(Buffer.from('a')));

		const root = await dav('PROPFIND', `${areaPath}/`, token).set('Depth', '1');
		const inA = await dav('PROPFIND', `${areaPath}/A/`, token).set('Depth', '1');
		const inB = await dav('PROPFIND', `${areaPath}/A/B/`, token).set('Depth', '1');

		expect(root.status).toEqual(207);
		expect(root.text).toContain('<D:displayname>A</D:displayname>');
		expect(root.text).toContain('<D:displayname>C</D:displayname>');
		expect(root.text).toContain('<D:displayname>top.txt</D:displayname>');
		expect(inA.text).toContain('<D:displayname>B</D:displayname>');
		expect(inA.text).toContain('<D:displayname>in-a.txt</D:displayname>');
		expect(inB.status).toEqual(207);
	});

	it('should create nested folders with MKCOL', async () => {
		const { token, folderB } = await setup();

		const top = await dav('MKCOL', `${areaPath}/Neu`, token);
		const nested = await dav('MKCOL', `${areaPath}/A/B/Tief`, token);

		expect(top.status).toEqual(HttpStatus.CREATED);
		expect(nested.status).toEqual(HttpStatus.CREATED);
		const created = (await folders()).find((node) => node.title === 'Tief');
		expect(created?.level).toEqual(3);
		expect(created?.path).toContain(folderB.id);
	});

	it('should store files in the board and in folders', async () => {
		const { token, board, folderB } = await setup();

		const onBoard = await dav('PUT', `${areaPath}/lose.txt`, token).send('x');
		const inFolder = await dav('PUT', `${areaPath}/A/B/tief.txt`, token).send('y');

		expect(onBoard.status).toEqual(HttpStatus.CREATED);
		expect(inFolder.status).toEqual(HttpStatus.CREATED);
		const parents = [...filesStorage.files.values()].map((file) => [file.record.name, file.record.parentId]);
		expect(parents).toEqual(
			expect.arrayContaining([
				['lose.txt', board.id],
				['tief.txt', folderB.id],
			])
		);
	});

	it('should move and rename folders', async () => {
		const { token, folderB, folderC } = await setup();

		const move = await dav('MOVE', `${areaPath}/C`, token).set('Destination', `${areaPath}/A/B/C`);
		const rename = await dav('MOVE', `${areaPath}/A/B`, token).set('Destination', `${areaPath}/A/Bee`);

		expect(move.status).toEqual(HttpStatus.CREATED);
		expect(rename.status).toEqual(HttpStatus.CREATED);
		const all = await folders();
		expect(all.find((node) => node.id === folderC.id)?.path).toContain(folderB.id);
		expect(all.find((node) => node.id === folderB.id)?.title).toEqual('Bee');
	});

	it('should refuse to move a folder into itself', async () => {
		const { token } = await setup();

		const response = await dav('MOVE', `${areaPath}/A`, token).set('Destination', `${areaPath}/A/B/A`);

		expect(response.status).toEqual(HttpStatus.BAD_REQUEST);
	});

	it('should move files between folders and delete folders with their subfolders', async () => {
		const { token, folderA, folderB, folderC } = await setup();
		await dav('PUT', `${areaPath}/A/datei.txt`, token).send('z');

		const move = await dav('MOVE', `${areaPath}/A/datei.txt`, token).set('Destination', `${areaPath}/C/datei.txt`);
		const del = await dav('DELETE', `${areaPath}/A`, token);

		expect(move.status).toEqual(HttpStatus.CREATED);
		expect([...filesStorage.files.values()].map((file) => file.record.parentId)).toEqual([folderC.id]);
		expect(del.status).toEqual(HttpStatus.NO_CONTENT);
		const remaining = (await folders()).map((node) => node.id);
		expect(remaining).toEqual([folderC.id]);
		expect(remaining).not.toContain(folderA.id);
		expect(remaining).not.toContain(folderB.id);
	});
});
