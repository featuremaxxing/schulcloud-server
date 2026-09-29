/* eslint-disable no-process-env */
import { EntityManager } from '@mikro-orm/mongodb';
import { ServerTestModule } from '@modules/server/server.app.module';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import { TestApiClientBuilder } from '@testing/test-api-client-builder';
import { AppPasswordEntity } from '../../repo';
import { appPasswordEntityFactory } from '../../testing';
import type { AppPasswordListResponse, CreatedAppPasswordResponse } from '../dto';

describe('app passwords (api)', () => {
	let app: INestApplication;
	let em: EntityManager;

	beforeAll(async () => {
		process.env.FEATURE_WEBDAV_ENABLED = 'true';

		const module: TestingModule = await Test.createTestingModule({
			imports: [ServerTestModule],
		}).compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
	});

	afterAll(async () => {
		await app.close();
		delete process.env.FEATURE_WEBDAV_ENABLED;
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	const setup = async () => {
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const { studentAccount, studentUser } = UserAndAccountTestFactory.buildStudent({ school: teacherUser.school });
		const foreignAppPassword = appPasswordEntityFactory.build({ userId: studentUser.id });
		await em.persist([teacherUser, teacherAccount, studentUser, studentAccount, foreignAppPassword]).flush();
		em.clear();

		const teacherClient = await new TestApiClientBuilder(app, 'app-passwords').build(teacherAccount);
		const studentClient = await new TestApiClientBuilder(app, 'app-passwords').build(studentAccount);

		return { teacherUser, teacherClient, studentClient, foreignAppPassword };
	};

	it('should create, list and revoke an app password without ever listing the secret', async () => {
		const { teacherUser, teacherClient } = await setup();

		const createResponse = await teacherClient.post(undefined, { name: 'Laptop' });
		expect(createResponse.status).toEqual(HttpStatus.CREATED);
		const created = createResponse.body as CreatedAppPasswordResponse;
		expect(created).toMatchObject({ name: 'Laptop', username: teacherUser.email });
		expect(created.token.startsWith(`${created.id}.`)).toBe(true);

		const listResponse = await teacherClient.get();
		expect(listResponse.status).toEqual(HttpStatus.OK);
		const list = listResponse.body as AppPasswordListResponse;
		expect(list.data).toEqual([expect.objectContaining({ id: created.id, name: 'Laptop' })]);
		expect(JSON.stringify(list)).not.toContain(created.token.split('.')[1]);

		const deleteResponse = await teacherClient.delete(created.id);
		expect(deleteResponse.status).toEqual(HttpStatus.NO_CONTENT);
		expect(await em.count(AppPasswordEntity, { id: created.id })).toEqual(0);
	});

	it('should not list or revoke app passwords of other users', async () => {
		const { teacherClient, foreignAppPassword } = await setup();

		const listResponse = await teacherClient.get();
		expect((listResponse.body as AppPasswordListResponse).data).toEqual([]);

		const deleteResponse = await teacherClient.delete(foreignAppPassword.id);
		expect(deleteResponse.status).toEqual(HttpStatus.NOT_FOUND);
		expect(await em.count(AppPasswordEntity, { id: foreignAppPassword.id })).toEqual(1);
	});

	it('should not let students create app passwords, but let them list and revoke their own', async () => {
		const { studentClient, foreignAppPassword } = await setup();

		const create = await studentClient.post(undefined, { name: 'Handy' });
		const list = await studentClient.get();
		const revoke = await studentClient.delete(foreignAppPassword.id);

		expect(create.status).toEqual(HttpStatus.FORBIDDEN);
		expect((list.body as AppPasswordListResponse).data).toHaveLength(1);
		expect(revoke.status).toEqual(HttpStatus.NO_CONTENT);
	});

	it('should reject an empty name', async () => {
		const { teacherClient } = await setup();

		const response = await teacherClient.post(undefined, { name: '' });

		expect(response.status).toEqual(HttpStatus.BAD_REQUEST);
	});

	it('should require a login', async () => {
		const response = await new TestApiClientBuilder(app, 'app-passwords').build().get();

		expect(response.status).toEqual(HttpStatus.UNAUTHORIZED);
	});
});
