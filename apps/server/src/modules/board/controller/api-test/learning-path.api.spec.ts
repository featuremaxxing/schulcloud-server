/* eslint-disable no-process-env */
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
import { BoardCompletionEntity, BoardNodeEntity } from '../../repo';
import {
	cardEntityFactory,
	checkboxElementEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
	learningPathStepEntityFactory,
} from '../../testing';

type StepJson = {
	id: string;
	linkedBoardId: string;
	title: string;
	status: string;
	prerequisiteStepIds: string[];
	doneCount?: number;
	studentCount?: number;
};
type PathJson = { isEditor: boolean; steps: StepJson[]; availableBoards: { id: string }[] };
type RoomBoardJson = {
	id: string;
	lockedByLearningPath?: { id: string; title: string };
	learningPath?: {
		steps: { boardId: string; title: string; status: string }[];
		studentCount?: number;
		completedStudentCount?: number;
	};
};

describe('learning path (api)', () => {
	let app: INestApplication;
	let em: EntityManager;

	beforeAll(async () => {
		process.env.FEATURE_BOARD_LEARNING_PATH_ENABLED = 'true';
		process.env.FEATURE_COLUMN_BOARD_CHECKBOX_ENABLED = 'true';
		const module: TestingModule = await Test.createTestingModule({ imports: [ServerTestModule] }).compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
	});

	afterAll(async () => {
		await app.close();
		delete process.env.FEATURE_BOARD_LEARNING_PATH_ENABLED;
		delete process.env.FEATURE_COLUMN_BOARD_CHECKBOX_ENABLED;
	});

	beforeEach(async () => {
		await cleanupCollections(em);
	});

	// path: A -> C (C locked until A is done), B stands alone. A has a checkbox, B has nothing.
	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const owner = userFactory.asTeacher().buildWithId({ school });
		const teacher = userFactory.asTeacher().buildWithId({ school });
		const student = userFactory.asStudent().buildWithId({ school });
		const teacherAccount = accountFactory.withUser(teacher).build();
		const studentAccount = accountFactory.withUser(student).build();

		const { roomOwnerRole, roomEditorRole, roomViewerRole } = RoomRolesTestFactory.createRoomRoles();
		const room = roomEntityFactory.buildWithId({ schoolId: school.id });
		const otherRoom = roomEntityFactory.buildWithId({ schoolId: school.id });
		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [
				{ user: owner, role: roomOwnerRole },
				{ user: teacher, role: roomEditorRole },
				{ user: student, role: roomViewerRole },
			],
			organization: school,
		});
		const roomMembership = roomMembershipEntityFactory.build({
			roomId: room.id,
			userGroupId: userGroup.id,
			schoolId: school.id,
		});

		const roomRef = { id: room.id, type: BoardExternalReferenceType.Room };
		const pathBoard = columnBoardEntityFactory.build({
			title: 'Lernweg',
			layout: BoardLayout.LEARNING_PATH,
			isVisible: true,
			context: roomRef,
		});
		const boardA = columnBoardEntityFactory.build({ title: 'A', isVisible: true, context: roomRef });
		const columnA = columnEntityFactory.withParent(boardA).build();
		const cardA = cardEntityFactory.withParent(columnA).build();
		const checkbox = checkboxElementEntityFactory.withParent(cardA).build({ creatorId: teacher.id });
		const boardB = columnBoardEntityFactory.build({ title: 'B', isVisible: true, context: roomRef });
		const boardC = columnBoardEntityFactory.build({ title: 'C', isVisible: true, context: roomRef });
		const foreignBoard = columnBoardEntityFactory.build({
			isVisible: true,
			context: { id: otherRoom.id, type: BoardExternalReferenceType.Room },
		});

		const stepA = learningPathStepEntityFactory.withParent(pathBoard).build({ linkedBoardId: boardA.id });
		const stepB = learningPathStepEntityFactory.withParent(pathBoard).build({ linkedBoardId: boardB.id });
		const stepC = learningPathStepEntityFactory.withParent(pathBoard).build({
			linkedBoardId: boardC.id,
			prerequisiteStepIds: [stepA.id],
			lockUntilPrerequisitesDone: true,
		});

		await em
			.persist([
				school,
				owner,
				teacher,
				student,
				teacherAccount,
				studentAccount,
				roomOwnerRole,
				roomEditorRole,
				roomViewerRole,
				room,
				otherRoom,
				userGroup,
				roomMembership,
				pathBoard,
				boardA,
				columnA,
				cardA,
				checkbox,
				boardB,
				boardC,
				foreignBoard,
				stepA,
				stepB,
				stepC,
			])
			.flush();
		em.clear();

		const teacherClient = await new TestApiClientBuilder(app, '').build(teacherAccount);
		const studentClient = await new TestApiClientBuilder(app, '').build(studentAccount);

		const checkTheBox = async () => {
			await em.nativeUpdate(
				BoardNodeEntity,
				{ id: checkbox.id },
				{ entries: [{ userId: student.id, checked: true, approved: false }] }
			);
			em.clear();
		};

		return {
			teacherClient,
			studentClient,
			student,
			room,
			pathBoard,
			boardA,
			boardB,
			boardC,
			foreignBoard,
			stepA,
			stepB,
			stepC,
			checkTheBox,
		};
	};

	const statusOf = (body: PathJson, boardId: string): string | undefined =>
		body.steps.find((step) => step.linkedBoardId === boardId)?.status;

	describe('GET /boards/:boardId/learning-path', () => {
		it('should show the teacher all steps with the class progress and the boards to add', async () => {
			const { teacherClient, pathBoard, boardA, boardB, boardC, foreignBoard } = await setup();

			const response = await teacherClient.get(`boards/${pathBoard.id}/learning-path`);

			expect(response.status).toEqual(200);
			const body = response.body as PathJson;
			expect(body.isEditor).toBe(true);
			expect(body.steps.map((step) => step.title)).toEqual(['A', 'B', 'C']);
			expect(body.steps[0]).toMatchObject({ doneCount: 0, studentCount: 1 });
			const available = body.availableBoards.map((board) => board.id);
			expect(available).toEqual(expect.arrayContaining([boardA.id, boardB.id, boardC.id]));
			expect(available).not.toContain(pathBoard.id);
			expect(available).not.toContain(foreignBoard.id);
		});

		it('should show a student which steps are locked', async () => {
			const { studentClient, pathBoard, boardA, boardB, boardC } = await setup();

			const response = await studentClient.get(`boards/${pathBoard.id}/learning-path`);

			expect(response.status).toEqual(200);
			const body = response.body as PathJson;
			expect(body.isEditor).toBe(false);
			expect(body.availableBoards).toEqual([]);
			expect(statusOf(body, boardA.id)).toBe('open');
			expect(statusOf(body, boardB.id)).toBe('open');
			expect(statusOf(body, boardC.id)).toBe('locked');
		});
	});

	describe('locking', () => {
		it('should keep a student out of a locked board until the prerequisite is done', async () => {
			const { studentClient, teacherClient, student, pathBoard, boardA, boardC, checkTheBox } = await setup();

			expect((await studentClient.get(`boards/${boardC.id}`)).status).toEqual(403);
			expect((await teacherClient.get(`boards/${boardC.id}`)).status).toEqual(200);

			await checkTheBox();

			expect((await studentClient.get(`boards/${boardC.id}`)).status).toEqual(200);
			const path = (await studentClient.get(`boards/${pathBoard.id}/learning-path`)).body as PathJson;
			expect(statusOf(path, boardA.id)).toBe('done');
			expect(statusOf(path, boardC.id)).toBe('open');
			// the completion is kept, so a new checkbox does not lock the path again
			const completion = await em.findOne(BoardCompletionEntity, { userId: student.id, boardId: boardA.id });
			expect(completion?.source).toBe('progress');
		});

		it('should list a locked board in the room with its learning path', async () => {
			const { studentClient, room, pathBoard, boardC } = await setup();

			const response = await studentClient.get(`rooms/${room.id}/boards`);

			expect(response.status).toEqual(200);
			const boards = (response.body as { data: RoomBoardJson[] }).data;
			const locked = boards.find((board) => board.id === boardC.id);
			expect(locked?.lockedByLearningPath).toEqual({ id: pathBoard.id, title: 'Lernweg' });
		});

		it('should give the student an overview of the learning path in the room', async () => {
			const { studentClient, room, pathBoard, boardA, boardC, checkTheBox } = await setup();
			await checkTheBox();

			const response = await studentClient.get(`rooms/${room.id}/boards`);

			const boards = (response.body as { data: RoomBoardJson[] }).data;
			const path = boards.find((board) => board.id === pathBoard.id)?.learningPath;
			expect(path?.steps.find((step) => step.boardId === boardA.id)).toMatchObject({ title: 'A', status: 'done' });
			expect(path?.steps.find((step) => step.boardId === boardC.id)?.status).toBe('open');
			expect(path?.studentCount).toBeUndefined();
			expect(boards.find((board) => board.id === boardA.id)?.learningPath).toBeUndefined();
		});

		it('should show the teacher how many students completed the learning path', async () => {
			const { teacherClient, studentClient, room, pathBoard, boardB, boardC, checkTheBox } = await setup();
			await checkTheBox();
			await studentClient.put(`boards/${boardB.id}/completion`, { completed: true });

			const before = (await teacherClient.get(`rooms/${room.id}/boards`)).body as { data: RoomBoardJson[] };
			expect(before.data.find((board) => board.id === pathBoard.id)?.learningPath).toMatchObject({
				studentCount: 1,
				completedStudentCount: 0,
			});

			await studentClient.put(`boards/${boardC.id}/completion`, { completed: true });

			const after = (await teacherClient.get(`rooms/${room.id}/boards`)).body as { data: RoomBoardJson[] };
			expect(after.data.find((board) => board.id === pathBoard.id)?.learningPath?.completedStudentCount).toBe(1);
		});

		it('should not lock anything while the learning path is a draft', async () => {
			const { studentClient, pathBoard, boardC } = await setup();
			await em.nativeUpdate(BoardNodeEntity, { id: pathBoard.id }, { isVisible: false });
			em.clear();

			expect((await studentClient.get(`boards/${boardC.id}`)).status).toEqual(200);
		});

		it('should open the board when one of several prerequisites is enough', async () => {
			const { studentClient, teacherClient, boardB, boardC, stepA, stepB, stepC } = await setup();

			await teacherClient.patch(`learning-path-steps/${stepC.id}`, {
				prerequisiteStepIds: [stepA.id, stepB.id],
				unlockMode: 'any',
			});
			await studentClient.put(`boards/${boardB.id}/completion`, { completed: true });

			expect((await studentClient.get(`boards/${boardC.id}`)).status).toEqual(200);
		});
	});

	describe('completion', () => {
		it('should let a student mark a board without progress items as done', async () => {
			const { studentClient, boardB } = await setup();

			const before = await studentClient.get(`boards/${boardB.id}/completion`);
			expect(before.body).toEqual({ inLearningPath: true, canMarkManually: true, completed: false });

			const response = await studentClient.put(`boards/${boardB.id}/completion`, { completed: true });

			expect(response.status).toEqual(200);
			expect((response.body as { completed: boolean }).completed).toBe(true);
		});

		it('should not let a student mark a board with progress items by hand', async () => {
			const { studentClient, boardA } = await setup();

			const completion = await studentClient.get(`boards/${boardA.id}/completion`);
			expect((completion.body as { canMarkManually: boolean }).canMarkManually).toBe(false);

			const response = await studentClient.put(`boards/${boardA.id}/completion`, { completed: true });
			expect(response.status).toEqual(403);
		});
	});

	describe('editing', () => {
		it('should add a board of the same room', async () => {
			const { teacherClient, pathBoard, boardA, room } = await setup();
			const boardD = columnBoardEntityFactory.build({
				title: 'D',
				context: { id: room.id, type: BoardExternalReferenceType.Room },
			});
			await em.persist(boardD).flush();

			const response = await teacherClient.post('learning-path-steps', {
				boardId: pathBoard.id,
				linkedBoardId: boardD.id,
				positionX: 10,
				positionY: 20,
			});

			expect(response.status).toEqual(201);
			const duplicate = await teacherClient.post('learning-path-steps', {
				boardId: pathBoard.id,
				linkedBoardId: boardA.id,
				positionX: 0,
				positionY: 0,
			});
			expect(duplicate.status).toEqual(400);
		});

		it('should refuse a board of another room', async () => {
			const { teacherClient, pathBoard, foreignBoard } = await setup();

			const response = await teacherClient.post('learning-path-steps', {
				boardId: pathBoard.id,
				linkedBoardId: foreignBoard.id,
				positionX: 0,
				positionY: 0,
			});

			expect(response.status).toEqual(400);
		});

		it('should refuse arrows that form a circle', async () => {
			const { teacherClient, stepA, stepC } = await setup();

			const response = await teacherClient.patch(`learning-path-steps/${stepA.id}`, {
				prerequisiteStepIds: [stepC.id],
			});

			expect(response.status).toEqual(400);
		});

		it('should remove the arrows of a deleted step', async () => {
			const { teacherClient, pathBoard, boardC, stepA } = await setup();

			const response = await teacherClient.delete(`learning-path-steps/${stepA.id}`);

			expect(response.status).toEqual(204);
			const path = (await teacherClient.get(`boards/${pathBoard.id}/learning-path`)).body as PathJson;
			expect(path.steps.find((step) => step.linkedBoardId === boardC.id)?.prerequisiteStepIds).toEqual([]);
		});

		it('should drop the step of a deleted board', async () => {
			const { teacherClient, pathBoard, boardA } = await setup();

			const response = await teacherClient.delete(`boards/${boardA.id}`);

			expect(response.status).toEqual(204);
			const path = (await teacherClient.get(`boards/${pathBoard.id}/learning-path`)).body as PathJson;
			expect(path.steps.map((step) => step.title)).toEqual(['B', 'C']);
			expect(path.steps[1].prerequisiteStepIds).toEqual([]);
		});

		it('should not let students change the path', async () => {
			const { studentClient, stepA } = await setup();

			const response = await studentClient.patch(`learning-path-steps/${stepA.id}`, { positionX: 5 });

			expect(response.status).toEqual(403);
		});
	});

	describe('POST /boards', () => {
		it('should create a learning path in a room', async () => {
			const { teacherClient, room } = await setup();

			const response = await teacherClient.post('boards', {
				title: 'Neuer Lernweg',
				parentId: room.id,
				parentType: BoardExternalReferenceType.Room,
				layout: BoardLayout.LEARNING_PATH,
			});

			expect(response.status).toEqual(201);
		});
	});
});
