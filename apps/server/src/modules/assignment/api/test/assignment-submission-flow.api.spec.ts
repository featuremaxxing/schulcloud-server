// Feature flag defaults to false; flipped per-module at compile time below, see setup().
/* eslint-disable no-process-env */
import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { EntityManager } from '@mikro-orm/mongodb';
import { FileDto, FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import { accountFactory } from '@modules/account/testing';
import { BoardExternalReferenceType } from '@modules/board';
import {
	assignmentElementEntityFactory,
	cardEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
} from '@modules/board/testing';
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
import {
	type AssignmentListResponse,
	type AssignmentSubmissionResponse,
	type AssignmentSubmissionListResponse,
} from '../dto';

const baseRouteName = '/assignments';

const buildFileDto = (parentId: string): FileDto =>
	new FileDto({
		id: 'file-1',
		name: 'submission.pdf',
		parentType: 'boardnodes' as FileDto['parentType'],
		parentId,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

describe('assignment submission flow (api)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let filesStorageClientAdapterService: DeepMocked<FilesStorageClientAdapterService>;

	beforeAll(async () => {
		// The feature flag defaults to false in production; the config is read once at module
		// compile time (see ConfigurationFactory), so this must be set before compiling.
		process.env.FEATURE_COLUMN_BOARD_ASSIGNMENT_ENABLED = 'true';

		const module: TestingModule = await Test.createTestingModule({
			imports: [ServerTestModule],
		})
			.overrideProvider(FilesStorageClientAdapterService)
			.useValue(createMock<FilesStorageClientAdapterService>())
			.compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
		filesStorageClientAdapterService = module.get(FilesStorageClientAdapterService);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await cleanupCollections(em);
		filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([]);
	});

	const setup = async (elementOverrides: Partial<Parameters<typeof assignmentElementEntityFactory.build>[0]> = {}) => {
		const school = schoolEntityFactory.buildWithId();

		// A room with no owner counts as locked (see RoomBoardContext.computeHasOwner /
		// boardConfiguration.isLocked), which blocks *every* permission check, teacher
		// included. This owner is not otherwise used by the tests below.
		const ownerUser = userFactory.buildWithId({ school });

		const teacherUser = userFactory.buildWithId({ school });
		const teacherAccount = accountFactory.withUser(teacherUser).build();

		const studentUser = userFactory.buildWithId({ school });
		const studentAccount = accountFactory.withUser(studentUser).build();

		const otherStudentUser = userFactory.buildWithId({ school });
		const otherStudentAccount = accountFactory.withUser(otherStudentUser).build();

		const { roomOwnerRole, roomEditorRole, roomViewerRole } = RoomRolesTestFactory.createRoomRoles();

		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [
				{ user: ownerUser, role: roomOwnerRole },
				{ user: teacherUser, role: roomEditorRole },
				{ user: studentUser, role: roomViewerRole },
				{ user: otherStudentUser, role: roomViewerRole },
			],
			organization: school,
		});

		const room = roomEntityFactory.buildWithId({ schoolId: school.id });
		const roomMembership = roomMembershipEntityFactory.build({ roomId: room.id, userGroupId: userGroup.id });

		await em
			.persist([
				school,
				ownerUser,
				teacherAccount,
				teacherUser,
				studentAccount,
				studentUser,
				otherStudentAccount,
				otherStudentUser,
				roomOwnerRole,
				roomEditorRole,
				roomViewerRole,
				userGroup,
				room,
				roomMembership,
			])
			.flush();

		const columnBoardNode = columnBoardEntityFactory.build({
			context: { id: room.id, type: BoardExternalReferenceType.Room },
		});
		const columnNode = columnEntityFactory.withParent(columnBoardNode).build();
		const cardNode = cardEntityFactory.withParent(columnNode).build();
		const assignmentElementNode = assignmentElementEntityFactory
			.withParent(cardNode)
			.build({ dueDate: undefined, graceMinutes: undefined, maxPoints: 10, ...elementOverrides });

		await em.persist([columnBoardNode, columnNode, cardNode, assignmentElementNode]).flush();
		em.clear();

		return {
			teacherAccount,
			studentAccount,
			otherStudentAccount,
			studentUser,
			assignmentElementNode,
			columnBoardNode,
			room,
		};
	};

	describe('when the feature flag is disabled', () => {
		it('should return 403', async () => {
			// The main app instance above already baked in "true" at its own compile time, so
			// flipping the env var here only affects this ad-hoc, separately compiled module.
			process.env.FEATURE_COLUMN_BOARD_ASSIGNMENT_ENABLED = 'false';

			const disabledModule: TestingModule = await Test.createTestingModule({
				imports: [ServerTestModule],
			})
				.overrideProvider(FilesStorageClientAdapterService)
				.useValue(createMock<FilesStorageClientAdapterService>())
				.compile();
			const disabledApp = disabledModule.createNestApplication();
			await disabledApp.init();
			const disabledEm = disabledModule.get(EntityManager);
			await cleanupCollections(disabledEm);

			const school = schoolEntityFactory.buildWithId();
			const studentUser = userFactory.buildWithId({ school });
			const studentAccount = accountFactory.withUser(studentUser).build();
			await disabledEm.persist([studentUser, studentAccount]).flush();
			disabledEm.clear();

			const client = await new TestApiClientBuilder(disabledApp, baseRouteName).build(studentAccount);
			const response = await client.post('000000000000000000000001/submissions');

			expect(response.status).toEqual(403);

			await disabledApp.close();
			process.env.FEATURE_COLUMN_BOARD_ASSIGNMENT_ENABLED = 'true';
		});
	});

	describe('the full submit -> grade -> return flow', () => {
		it('should walk a submission through OPEN -> SUBMITTED -> (graded) -> RETURNED', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			// 1. student starts a submission
			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			expect(createResponse.status).toEqual(201);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			expect(submissionId).not.toBeNull();

			// 2. submitting without a file is rejected
			const submitWithoutFile = await studentClient.patch(`submissions/${submissionId}/submit`);
			expect(submitWithoutFile.status).toEqual(409);

			// 3. once a file exists, submitting succeeds
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);
			const submitResponse = await studentClient.patch(`submissions/${submissionId}/submit`);
			expect(submitResponse.status).toEqual(200);
			expect((submitResponse.body as AssignmentSubmissionResponse).status).toEqual('submitted');
			expect((submitResponse.body as AssignmentSubmissionResponse).isLate).toBe(false);

			// 4. the student does not see points before the teacher returns it
			const ownListBeforeReturn = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownEntryBeforeReturn = (ownListBeforeReturn.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownEntryBeforeReturn.points).toBeNull();

			// 5. the teacher sees every student in the room, including this submission, and can
			// save a draft grade without returning it
			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntries = (teacherList.body as AssignmentSubmissionListResponse).submissions;
			expect(teacherEntries).toHaveLength(2);
			const teacherEntry = teacherEntries.find((e) => e.id === submissionId);
			expect(teacherEntry?.status).toEqual('submitted');

			const gradeResponse = await teacherClient.patch(`submissions/${submissionId}/grade`, { points: 7 });
			expect(gradeResponse.status).toEqual(200);
			expect((gradeResponse.body as AssignmentSubmissionResponse).status).toEqual('inReview');

			// draft grade must still be invisible to the student
			const ownListAfterDraft = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			expect((ownListAfterDraft.body as AssignmentSubmissionListResponse).submissions[0].points).toBeNull();

			// 6. returning reveals it
			const returnResponse = await teacherClient.post(`submissions/${submissionId}/return`, {
				points: 9,
				feedbackComment: 'well done',
			});
			expect(returnResponse.status).toEqual(200);
			expect((returnResponse.body as AssignmentSubmissionResponse).status).toEqual('returned');

			const ownListAfterReturn = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownEntryAfterReturn = (ownListAfterReturn.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownEntryAfterReturn.points).toEqual(9);
			expect(ownEntryAfterReturn.feedbackComment).toEqual('well done');
		});
	});

	describe('isolation between students', () => {
		it('should never let a student see another student’s submission', async () => {
			const { teacherAccount, studentAccount, otherStudentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const otherStudentClient = await new TestApiClientBuilder(app, baseRouteName).build(otherStudentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			await studentClient.post(`${assignmentElementNode.id}/submissions`);

			const otherStudentList = await otherStudentClient.get(`${assignmentElementNode.id}/submissions`);
			const otherEntries = (otherStudentList.body as AssignmentSubmissionListResponse).submissions;
			expect(otherEntries).toHaveLength(1);
			expect(otherEntries[0].id).toBeNull(); // otherStudent has not submitted anything themselves

			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntries = (teacherList.body as AssignmentSubmissionListResponse).submissions;
			expect(teacherEntries).toHaveLength(2); // both students listed, teacher sees everyone
		});

		it('should not allow a student to grade a submission', async () => {
			const { studentAccount, assignmentElementNode } = await setup();
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await studentClient.patch(`submissions/${submissionId}/grade`, { points: 10 });

			expect(response.status).toEqual(403);
		});
	});

	describe('when the due date and grace period have passed', () => {
		it('should reject creating a new submission', async () => {
			const { studentAccount, assignmentElementNode } = await setup({
				dueDate: new Date('2020-01-01T00:00:00.000Z'),
				graceMinutes: 0,
			});
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);

			const response = await studentClient.post(`${assignmentElementNode.id}/submissions`);

			expect(response.status).toEqual(403);
		});
	});

	describe('when the start date is in the future', () => {
		it('should reject creating a new submission', async () => {
			const { studentAccount, assignmentElementNode } = await setup({
				startDate: new Date('2099-01-01T00:00:00.000Z'),
			});
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);

			const response = await studentClient.post(`${assignmentElementNode.id}/submissions`);

			expect(response.status).toEqual(403);
		});
	});

	describe('the assignments list', () => {
		it('should list the room assignment for the teacher with submission counts', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode, columnBoardNode, room } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			await studentClient.post(`${assignmentElementNode.id}/submissions`);

			const response = await teacherClient.get('');

			expect(response.status).toEqual(200);
			const list = response.body as AssignmentListResponse;
			expect(list.assignments).toHaveLength(1);
			const item = list.assignments[0];
			expect(item.id).toEqual(assignmentElementNode.id);
			expect(item.roomId).toEqual(room.id);
			expect(item.boardId).toEqual(columnBoardNode.id);
			expect(item.title).toEqual(assignmentElementNode.title);
			expect(item.isStarted).toBe(true);
			expect(item.isSubmittable).toBe(true);
			expect(item.submissionsTotal).toEqual(1);
			expect(item.submissionsSubmitted).toEqual(0);
		});

		it('should count handed-in submissions for the teacher', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);
			await studentClient.patch(`submissions/${submissionId}/submit`);

			const response = await teacherClient.get('');

			const item = (response.body as AssignmentListResponse).assignments[0];
			expect(item.submissionsTotal).toEqual(1);
			expect(item.submissionsSubmitted).toEqual(1);
		});

		it('should show students their own submission status, but no counts', async () => {
			const { studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			await studentClient.post(`${assignmentElementNode.id}/submissions`);

			const response = await studentClient.get('');

			expect(response.status).toEqual(200);
			const item = (response.body as AssignmentListResponse).assignments[0];
			expect(item.ownSubmissionStatus).toEqual('open');
			expect(item.ownSubmissionIsLate).toBe(false);
			expect(item.submissionsTotal).toBeNull();
			expect(item.submissionsSubmitted).toBeNull();
		});

		it('should return an empty list for users without rooms', async () => {
			const school = schoolEntityFactory.buildWithId();
			const lonelyUser = userFactory.buildWithId({ school });
			const lonelyAccount = accountFactory.withUser(lonelyUser).build();
			await em.persist([school, lonelyUser, lonelyAccount]).flush();
			em.clear();

			const client = await new TestApiClientBuilder(app, baseRouteName).build(lonelyAccount);
			const response = await client.get('');

			expect(response.status).toEqual(200);
			expect((response.body as AssignmentListResponse).assignments).toHaveLength(0);
		});

		it('should return nothing when filtering by a room the user is not in', async () => {
			const { teacherAccount } = await setup();

			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);
			const response = await teacherClient.get('?roomId=000000000000000000000002');

			expect(response.status).toEqual(200);
			expect((response.body as AssignmentListResponse).assignments).toHaveLength(0);
		});
	});
});
