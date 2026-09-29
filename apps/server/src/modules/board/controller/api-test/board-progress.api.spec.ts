/* eslint-disable no-process-env */
import { EntityManager } from '@mikro-orm/mongodb';
import { courseEntityFactory } from '@modules/course/testing';
import { ServerTestModule } from '@modules/server/server.app.module';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import { TestApiClient } from '@testing/test-api-client';
import { BoardExternalReferenceType } from '../../domain';
import {
	assignmentElementEntityFactory,
	assignmentSubmissionEntityFactory,
	cardEntityFactory,
	checkboxElementEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
} from '../../testing';

describe('board progress (api)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let testApiClient: TestApiClient;

	beforeAll(async () => {
		// Feature flags default to false and are read once at module compile time, so they must
		// be set before compiling (see assignment-submission-flow.api.spec.ts for the pattern).
		process.env.FEATURE_BOARD_PROGRESS_ENABLED = 'true';
		process.env.FEATURE_COLUMN_BOARD_CHECKBOX_ENABLED = 'true';
		process.env.FEATURE_COLUMN_BOARD_ASSIGNMENT_ENABLED = 'true';

		const module: TestingModule = await Test.createTestingModule({
			imports: [ServerTestModule],
		}).compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
		testApiClient = new TestApiClient(app, 'boards');
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	const setup = async () => {
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const { studentAccount, studentUser } = UserAndAccountTestFactory.buildStudent({
			school: teacherUser.school,
			firstName: 'Anna',
			lastName: 'Beispiel',
		});
		const { studentAccount: otherStudentAccount, studentUser: otherStudentUser } =
			UserAndAccountTestFactory.buildStudent({ school: teacherUser.school, firstName: 'Otto', lastName: 'Other' });

		const course = courseEntityFactory.build({
			school: teacherUser.school,
			teachers: [teacherUser],
			students: [studentUser, otherStudentUser],
		});
		await em
			.persist([
				teacherUser,
				teacherAccount,
				studentUser,
				studentAccount,
				otherStudentUser,
				otherStudentAccount,
				course,
			])
			.flush();

		const columnBoardNode = columnBoardEntityFactory.build({
			context: { id: course.id, type: BoardExternalReferenceType.Course },
		});
		const column = columnEntityFactory.withParent(columnBoardNode).build();
		const card = cardEntityFactory.withParent(column).build({ title: 'My Card' });
		const checkbox = checkboxElementEntityFactory.withParent(card).build({
			creatorId: teacherUser.id,
			requireTeacherConfirmation: false,
			entries: [{ userId: studentUser.id, checked: true, approved: false }],
		});
		const assignment = assignmentElementEntityFactory.withParent(card).build({ title: 'My Assignment' });
		const submission = assignmentSubmissionEntityFactory
			.withParent(assignment)
			.build({ userId: studentUser.id, submittedAt: new Date() });

		await em.persist([card, column, columnBoardNode, checkbox, assignment, submission]).flush();
		em.clear();

		const teacherClient = await testApiClient.login(teacherAccount);
		const studentClient = await testApiClient.login(studentAccount);
		const otherStudentClient = await testApiClient.login(otherStudentAccount);

		return { teacherClient, studentClient, otherStudentClient, boardId: columnBoardNode.id };
	};

	it('returns the class progress to the teacher, with per-student details on request', async () => {
		const { teacherClient, boardId } = await setup();

		const response = await teacherClient.get(`${boardId}/progress?details=true`);

		expect(response.statusCode).toEqual(HttpStatus.OK);
		expect(response.body).toMatchObject({
			boardId,
			isTeacherView: true,
			// 2 items (checkbox + assignment) x 2 eligible students = 4, 2 of which are done
			summary: { done: 2, total: 4 },
		});
		const { items } = response.body as {
			items: { type: string; doneCount: number; eligibleCount: number; students?: unknown[] }[];
		};
		expect(items).toHaveLength(2);
		expect(items.every((item) => item.doneCount === 1 && item.eligibleCount === 2)).toBe(true);
		expect(items.every((item) => Array.isArray(item.students) && item.students?.length === 2)).toBe(true);
	});

	it('omits the student breakdown from the teacher view without ?details', async () => {
		const { teacherClient, boardId } = await setup();

		const response = await teacherClient.get(`${boardId}/progress`);

		expect(response.statusCode).toEqual(HttpStatus.OK);
		const { items } = response.body as { items: { students?: unknown[] }[] };
		expect(items.every((item) => item.students === undefined)).toBe(true);
	});

	it('returns only the own progress to a student, with no student breakdown', async () => {
		const { studentClient, boardId } = await setup();

		const response = await studentClient.get(`${boardId}/progress`);

		expect(response.statusCode).toEqual(HttpStatus.OK);
		expect(response.body).toMatchObject({ boardId, isTeacherView: false, summary: { done: 2, total: 2 } });
		const { items } = response.body as { items: { done: boolean; students?: unknown[] }[] };
		expect(items.every((item) => item.done === true && item.students === undefined)).toBe(true);
	});

	it("shows the other student's own progress as not done yet", async () => {
		const { otherStudentClient, boardId } = await setup();

		const response = await otherStudentClient.get(`${boardId}/progress`);

		expect(response.statusCode).toEqual(HttpStatus.OK);
		expect(response.body).toMatchObject({ isTeacherView: false, summary: { done: 0, total: 2 } });
	});

	it('rejects access to a board the caller is not a member of', async () => {
		const { boardId } = await setup();
		const { studentAccount: strangerAccount, studentUser: strangerUser } = UserAndAccountTestFactory.buildStudent();
		await em.persist([strangerUser, strangerAccount]).flush();
		const strangerClient = await testApiClient.login(strangerAccount);

		const response = await strangerClient.get(`${boardId}/progress`);

		expect(response.statusCode).toEqual(HttpStatus.FORBIDDEN);
	});

	it('should return 403 when the feature flag is off', async () => {
		const { boardId } = await setup();

		process.env.FEATURE_BOARD_PROGRESS_ENABLED = 'false';
		const disabledModule: TestingModule = await Test.createTestingModule({ imports: [ServerTestModule] }).compile();
		const disabledApp = disabledModule.createNestApplication();
		await disabledApp.init();
		const disabledEm = disabledModule.get(EntityManager);
		const { studentAccount, studentUser } = UserAndAccountTestFactory.buildStudent();
		await disabledEm.persist([studentUser, studentAccount]).flush();
		disabledEm.clear();
		const disabledClient = new TestApiClient(disabledApp, 'boards');
		const disabledStudentClient = await disabledClient.login(studentAccount);

		const response = await disabledStudentClient.get(`${boardId}/progress`);

		expect(response.statusCode).toEqual(HttpStatus.FORBIDDEN);

		await disabledApp.close();
		process.env.FEATURE_BOARD_PROGRESS_ENABLED = 'true';
	});
});
