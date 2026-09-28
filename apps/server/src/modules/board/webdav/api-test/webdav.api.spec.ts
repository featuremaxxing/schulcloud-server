/* eslint-disable no-process-env */
import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
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
import { BoardExternalReferenceType, BoardNodeType } from '../../domain';
import { BoardNodeEntity } from '../../repo';
import { cardEntityFactory, columnBoardEntityFactory, columnEntityFactory } from '../../testing';
import { createWebDavPreMiddleware } from '../webdav-pre.middleware';
import { WEBDAV_ROUTE } from '../webdav.constants';
import { type WebDavDownload, type WebDavFileRecord, WebDavFilesStorageClient } from '../webdav-files-storage.client';

// In-memory stand-in for the file storage service, keyed by parent (element) id.
class FakeFilesStorage {
	public readonly files = new Map<string, { record: WebDavFileRecord; content: Buffer }>();

	public list(_jwt: string, _schoolId: string, parentId: string): Promise<WebDavFileRecord[]> {
		return Promise.resolve(
			[...this.files.values()].filter((file) => file.record.parentId === parentId).map((file) => file.record)
		);
	}

	public download(_jwt: string, fileRecord: WebDavFileRecord): Promise<WebDavDownload> {
		const file = this.files.get(fileRecord.id);
		if (!file) throw new Error('not found');

		return Promise.resolve({
			status: 200,
			headers: { 'content-type': file.record.mimeType, 'content-length': String(file.content.length) },
			stream: Readable.from(file.content),
		});
	}

	public async upload(
		_jwt: string,
		_schoolId: string,
		parentId: string,
		fileName: string,
		content: Readable
	): Promise<WebDavFileRecord> {
		const chunks: Buffer[] = [];
		for await (const chunk of content) {
			chunks.push(Buffer.from(chunk as Buffer));
		}
		// like the real file storage: a duplicate name in the same parent gets renamed
		const taken = [...this.files.values()].some((f) => f.record.parentId === parentId && f.record.name === fileName);
		const name = taken ? fileName.replace(/(\.[^.]*)?$/, ' (1)$1') : fileName;
		const record: WebDavFileRecord = {
			id: new ObjectId().toHexString(),
			name,
			size: Buffer.concat(chunks).length,
			mimeType: 'text/plain',
			parentId,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		this.files.set(record.id, { record, content: Buffer.concat(chunks) });

		return record;
	}

	public rename(_jwt: string, fileRecordId: string, fileName: string): Promise<WebDavFileRecord> {
		const file = this.files.get(fileRecordId);
		if (!file) throw new Error('not found');
		file.record = { ...file.record, name: fileName };

		return Promise.resolve(file.record);
	}

	public delete(_jwt: string, fileRecordId: string): Promise<void> {
		this.files.delete(fileRecordId);

		return Promise.resolve();
	}
}

describe('webdav drive (api)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let appPasswordService: AppPasswordService;
	const filesStorage = new FakeFilesStorage();

	beforeAll(async () => {
		process.env.FEATURE_WEBDAV_ENABLED = 'true';

		const module: TestingModule = await Test.createTestingModule({
			imports: [ServerTestModule],
		})
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

	const setup = async () => {
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const { studentAccount, studentUser } = UserAndAccountTestFactory.buildStudent({ school: teacherUser.school });
		const course = courseEntityFactory.build({
			name: 'Mathe 7b',
			school: teacherUser.school,
			teachers: [teacherUser],
			students: [studentUser],
		});
		await em.persist([teacherUser, teacherAccount, studentUser, studentAccount, course]).flush();

		const board = columnBoardEntityFactory.build({
			title: 'Brüche',
			context: { id: course.id, type: BoardExternalReferenceType.Course },
			isVisible: true,
		});
		const column = columnEntityFactory.withParent(board).build({ title: 'Woche 1' });
		const otherColumn = columnEntityFactory.withParent(board).build({ title: 'Woche 2' });
		const card = cardEntityFactory.withParent(column).build({ title: 'Arbeitsblätter' });
		await em.persist([board, column, otherColumn, card]).flush();
		em.clear();

		const { token: teacherToken } = await appPasswordService.create(teacherUser.id, 'test');
		const { token: studentToken } = await appPasswordService.create(studentUser.id, 'test');

		return { teacherToken, studentToken, board, column, otherColumn, card };
	};

	const cardPath = '/webdav/Kurse/Mathe%207b/Br%C3%BCche/Woche%201/Arbeitsbl%C3%A4tter';

	const childrenOf = async (parentId: string): Promise<BoardNodeEntity[]> => {
		em.clear();
		const nodes = await em.find(BoardNodeEntity, { path: new RegExp(`,${parentId},$`) });

		return nodes;
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
		it('should show courses, boards, columns and cards as folders', async () => {
			const { teacherToken } = await setup();

			const root = await dav('PROPFIND', '/webdav/', teacherToken).set('Depth', '1');
			const courses = await dav('PROPFIND', '/webdav/Kurse/', teacherToken).set('Depth', '1');
			const board = await dav('PROPFIND', '/webdav/Kurse/Mathe%207b/Br%C3%BCche/', teacherToken).set('Depth', '1');

			expect(root.status).toEqual(207);
			expect(root.text).toContain('<D:href>/webdav/Kurse/</D:href>');
			expect(root.text).toContain('<D:href>/webdav/R%C3%A4ume/</D:href>');
			expect(courses.text).toContain('<D:displayname>Mathe 7b</D:displayname>');
			expect(board.text).toContain('<D:displayname>Woche 1</D:displayname>');
			expect(board.text).toContain('<D:displayname>Woche 2</D:displayname>');
		});

		it('should refuse infinite depth and answer 404 for unknown paths', async () => {
			const { teacherToken } = await setup();

			const infinite = await dav('PROPFIND', '/webdav/', teacherToken).set('Depth', 'infinity');
			const unknown = await dav('PROPFIND', '/webdav/Kurse/Gibt%20es%20nicht/', teacherToken);

			expect(infinite.status).toEqual(HttpStatus.FORBIDDEN);
			expect(unknown.status).toEqual(HttpStatus.NOT_FOUND);
		});
	});

	describe('files', () => {
		it('should store a file put into a card as a file element and serve it back', async () => {
			const { teacherToken, card } = await setup();

			const put = await dav('PUT', `${cardPath}/notizen.txt`, teacherToken).send('Hallo Welt');
			const listing = await dav('PROPFIND', `${cardPath}/`, teacherToken).set('Depth', '1');
			const get = await dav('GET', `${cardPath}/notizen.txt`, teacherToken);

			expect(put.status).toEqual(HttpStatus.CREATED);
			const elements = await childrenOf(card.id);
			expect(elements.map((element) => element.type)).toEqual([BoardNodeType.FILE_ELEMENT]);
			expect(listing.text).toContain('<D:displayname>notizen.txt</D:displayname>');
			expect(get.status).toEqual(HttpStatus.OK);
			expect(get.text).toEqual('Hallo Welt');
		});

		it('should replace the content of an existing file under the same name', async () => {
			const { teacherToken, card } = await setup();
			await dav('PUT', `${cardPath}/notizen.txt`, teacherToken).send('alt');

			const replace = await dav('PUT', `${cardPath}/notizen.txt`, teacherToken).send('neu');
			const get = await dav('GET', `${cardPath}/notizen.txt`, teacherToken);

			expect(replace.status).toEqual(HttpStatus.NO_CONTENT);
			expect(get.text).toEqual('neu');
			expect(filesStorage.files.size).toEqual(1);
			expect(await childrenOf(card.id)).toHaveLength(1);
		});

		it('should rename and delete files', async () => {
			const { teacherToken, card } = await setup();
			await dav('PUT', `${cardPath}/a.txt`, teacherToken).send('x');

			const move = await dav('MOVE', `${cardPath}/a.txt`, teacherToken).set('Destination', `${cardPath}/b.txt`);
			const oldName = await dav('PROPFIND', `${cardPath}/a.txt`, teacherToken).set('Depth', '0');
			const deleted = await dav('DELETE', `${cardPath}/b.txt`, teacherToken);

			expect(move.status).toEqual(HttpStatus.CREATED);
			expect(oldName.status).toEqual(HttpStatus.NOT_FOUND);
			expect(deleted.status).toEqual(HttpStatus.NO_CONTENT);
			expect(await childrenOf(card.id)).toHaveLength(0);
		});

		it('should accept but not store system files', async () => {
			const { teacherToken, card } = await setup();

			const put = await dav('PUT', `${cardPath}/._notizen.txt`, teacherToken).send('metadata');

			expect(put.status).toEqual(HttpStatus.CREATED);
			expect(await childrenOf(card.id)).toHaveLength(0);
			expect(filesStorage.files.size).toEqual(0);
		});

		it('should keep system files readable without storing them in the board', async () => {
			const { teacherToken, card } = await setup();

			await dav('PUT', `${cardPath}/._notizen.txt`, teacherToken).send('metadata');
			const propfind = await dav('PROPFIND', `${cardPath}/._notizen.txt`, teacherToken).set('Depth', '0');
			const get = await dav('GET', `${cardPath}/._notizen.txt`, teacherToken);
			const listing = await dav('PROPFIND', `${cardPath}/`, teacherToken).set('Depth', '1');
			const deleted = await dav('DELETE', `${cardPath}/._notizen.txt`, teacherToken);
			const afterDelete = await dav('PROPFIND', `${cardPath}/._notizen.txt`, teacherToken).set('Depth', '0');

			expect(propfind.status).toEqual(207);
			expect(Buffer.from(get.body as Buffer).toString()).toEqual('metadata');
			expect(listing.text).not.toContain('._notizen.txt');
			expect(deleted.status).toEqual(HttpStatus.NO_CONTENT);
			expect(afterDelete.status).toEqual(HttpStatus.NOT_FOUND);
			expect(await childrenOf(card.id)).toHaveLength(0);
		});

		it('should support the Finder write sequence (empty PUT, LOCK, PUT, metadata, UNLOCK)', async () => {
			const { teacherToken, card } = await setup();
			const lockBody =
				'<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>finder</D:href></D:owner></D:lockinfo>';

			const lockNew = await dav('LOCK', `${cardPath}/bericht.txt`, teacherToken)
				.set('Content-Type', 'text/xml')
				.send(lockBody);
			const placeholder = await dav('PROPFIND', `${cardPath}/bericht.txt`, teacherToken).set('Depth', '0');
			const emptyPut = await dav('PUT', `${cardPath}/bericht.txt`, teacherToken).set('Content-Length', '0');
			const contentPut = await dav('PUT', `${cardPath}/bericht.txt`, teacherToken)
				.set('If', `(${String(lockNew.headers['lock-token'])})`)
				.send('Inhalt');
			const metadata = await dav('PUT', `${cardPath}/._bericht.txt`, teacherToken).send('meta');
			const metadataCheck = await dav('PROPFIND', `${cardPath}/._bericht.txt`, teacherToken).set('Depth', '0');
			const unlock = await dav('UNLOCK', `${cardPath}/bericht.txt`, teacherToken).set(
				'Lock-Token',
				String(lockNew.headers['lock-token'])
			);
			const get = await dav('GET', `${cardPath}/bericht.txt`, teacherToken);

			expect(lockNew.status).toEqual(HttpStatus.CREATED);
			expect(placeholder.status).toEqual(207);
			expect([emptyPut.status, contentPut.status]).toEqual([HttpStatus.CREATED, HttpStatus.NO_CONTENT]);
			expect([metadata.status, metadataCheck.status, unlock.status]).toEqual([201, 207, 204]);
			expect(get.text).toEqual('Inhalt');
			expect(await childrenOf(card.id)).toHaveLength(1);
			expect(filesStorage.files.size).toEqual(1);
		});

		it('should not overwrite JSON content with the body parser', async () => {
			const { teacherToken } = await setup();
			const json = '{ "a" :   1 }';

			await dav('PUT', `${cardPath}/daten.json`, teacherToken).set('Content-Type', 'application/json').send(json);
			const get = await dav('GET', `${cardPath}/daten.json`, teacherToken);

			expect(get.text).toEqual(json);
		});
	});

	describe('structure', () => {
		it('should create columns, cards and folder elements with MKCOL', async () => {
			const { teacherToken, board } = await setup();

			const column = await dav('MKCOL', '/webdav/Kurse/Mathe%207b/Br%C3%BCche/Woche%203', teacherToken);
			const card = await dav('MKCOL', '/webdav/Kurse/Mathe%207b/Br%C3%BCche/Woche%203/Neue%20Karte', teacherToken);
			const folder = await dav(
				'MKCOL',
				'/webdav/Kurse/Mathe%207b/Br%C3%BCche/Woche%203/Neue%20Karte/Material',
				teacherToken
			);
			const upload = await dav(
				'PUT',
				'/webdav/Kurse/Mathe%207b/Br%C3%BCche/Woche%203/Neue%20Karte/Material/text.txt',
				teacherToken
			).send('im Ordner');

			expect([column.status, card.status, folder.status, upload.status]).toEqual([201, 201, 201, 201]);
			const columns = await childrenOf(board.id);
			const newColumn = columns.find((node) => node.title === 'Woche 3');
			expect(newColumn).toBeDefined();
			const [newCard] = await childrenOf(newColumn?.id ?? '');
			expect(newCard.title).toEqual('Neue Karte');
			const [newFolder] = await childrenOf(newCard.id);
			expect(newFolder.type).toEqual(BoardNodeType.FILE_FOLDER_ELEMENT);
			expect(newFolder.title).toEqual('Material');
			expect([...filesStorage.files.values()][0].record.parentId).toEqual(newFolder.id);
		});

		it('should move a card into another column and rename it', async () => {
			const { teacherToken, card, otherColumn } = await setup();

			const move = await dav('MOVE', `${cardPath}/`, teacherToken).set(
				'Destination',
				'/webdav/Kurse/Mathe%207b/Br%C3%BCche/Woche%202/Verschoben/'
			);

			expect(move.status).toEqual(HttpStatus.CREATED);
			const [movedCard] = await childrenOf(otherColumn.id);
			expect(movedCard.id).toEqual(card.id);
			expect(movedCard.title).toEqual('Verschoben');
		});

		it('should not allow deleting a whole board', async () => {
			const { teacherToken } = await setup();

			const response = await dav('DELETE', '/webdav/Kurse/Mathe%207b/Br%C3%BCche/', teacherToken);

			expect(response.status).toEqual(HttpStatus.FORBIDDEN);
		});
	});

	describe('as a student (board reader)', () => {
		it('should allow reading but not changing the board', async () => {
			const { studentToken } = await setup();

			const read = await dav('PROPFIND', `${cardPath}/`, studentToken).set('Depth', '1');
			const mkcol = await dav('MKCOL', `${cardPath}/Ordner`, studentToken);
			const put = await dav('PUT', `${cardPath}/x.txt`, studentToken).send('x');

			expect(read.status).toEqual(207);
			expect(mkcol.status).toEqual(HttpStatus.FORBIDDEN);
			expect(put.status).toEqual(HttpStatus.FORBIDDEN);
		});
	});
});
