// Feature flag defaults to false; flipped per-module at compile time below, see setup().
/* eslint-disable no-process-env */
import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { EntityManager } from '@mikro-orm/mongodb';
import { FileDto, FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import { accountFactory } from '@modules/account/testing';
import { BoardExternalReferenceType } from '@modules/board';
import {
	assignmentElementEntityFactory,
	assignmentSubmissionEntityFactory,
	cardEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
} from '@modules/board/testing';
import { GroupEntityTypes } from '@modules/group/entity';
import { groupEntityFactory } from '@modules/group/testing';
import { RoomContentType } from '@modules/room';
import { roomContentEntityFactory } from '@modules/room/testing';
import { roomMembershipEntityFactory } from '@modules/room-membership/testing';
import { BoardNodeEntity } from '@modules/board/repo/entity/board-node.entity';
import { roomEntityFactory } from '@modules/room/testing';
import { RoomRolesTestFactory } from '@modules/room/testing/room-roles.test.factory';
import { RoleName } from '@modules/role';
import { roleFactory } from '@modules/role/testing';
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
	type BatchReturnSubmissionsResponse,
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

		// listAssignments() gates the caller's view on the school-level role (see
		// assignment.uc.ts isStudentSchoolRole), not just the room role - a room viewer with
		// no STUDENT/TEACHER role at all sees neither the teacher nor the student list.
		const teacherSchoolRole = roleFactory.buildWithId({ name: RoleName.TEACHER });
		const studentSchoolRole = roleFactory.buildWithId({ name: RoleName.STUDENT });

		const teacherUser = userFactory.buildWithId({ school, roles: [teacherSchoolRole] });
		const teacherAccount = accountFactory.withUser(teacherUser).build();

		const studentUser = userFactory.buildWithId({ school, roles: [studentSchoolRole] });
		const studentAccount = accountFactory.withUser(studentUser).build();

		const otherStudentUser = userFactory.buildWithId({ school, roles: [studentSchoolRole] });
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
				teacherSchoolRole,
				studentSchoolRole,
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

		// the room content list links the board to the room - without it the board is
		// unreachable through the room and the assignment list must not surface it
		const roomContent = roomContentEntityFactory.build({
			roomId: room.id,
			items: [{ id: columnBoardNode.id, type: RoomContentType.BOARD }],
		});

		await em.persist([columnBoardNode, columnNode, cardNode, assignmentElementNode, roomContent]).flush();
		em.clear();

		return {
			teacherAccount,
			teacherUser,
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

		it('should not clear an already-saved grade when a later save only carries a comment', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);
			await studentClient.patch(`submissions/${submissionId}/submit`);

			const firstGrade = await teacherClient.patch(`submissions/${submissionId}/grade`, { points: 7 });
			expect((firstGrade.body as AssignmentSubmissionResponse).points).toEqual(7);

			// a second save that only touches the comment must not silently drop the points
			// that were already saved (see AssignmentUc.gradeSubmission)
			const secondGrade = await teacherClient.patch(`submissions/${submissionId}/grade`, {
				feedbackComment: 'still 7 points',
			});
			expect(secondGrade.status).toEqual(200);
			expect((secondGrade.body as AssignmentSubmissionResponse).points).toEqual(7);
			expect((secondGrade.body as AssignmentSubmissionResponse).feedbackComment).toEqual('still 7 points');
		});
	});

	describe('multiple teachers in the same room', () => {
		it('should show who graded a submission', async () => {
			const { teacherAccount, teacherUser, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			await teacherClient.patch(`submissions/${submissionId}/grade`, { points: 7 });

			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntry = (teacherList.body as AssignmentSubmissionListResponse).submissions.find(
				(entry) => entry.id === submissionId
			);
			expect(teacherEntry?.gradedByFirstName).toEqual(teacherUser.firstName);
			expect(teacherEntry?.gradedByLastName).toEqual(teacherUser.lastName);

			// the student's own view must never reveal who graded it
			const ownList = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownEntry = (ownList.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownEntry.gradedByFirstName).toBeUndefined();
			expect(ownEntry.gradedByLastName).toBeUndefined();
		});

		it('should not treat a colleague added as a room viewer as a student', async () => {
			// a teacher who was only given viewing rights in this room (e.g. to sit in on a
			// co-taught class) must not show up in the submission list as if they were a
			// student expected to hand something in - see assignment.uc.ts isStudentMember
			const school = schoolEntityFactory.buildWithId();
			const ownerUser = userFactory.buildWithId({ school });
			const teacherUser = userFactory.buildWithId({
				school,
				roles: [roleFactory.buildWithId({ name: RoleName.TEACHER })],
			});
			const teacherAccount = accountFactory.withUser(teacherUser).build();
			const colleagueUser = userFactory.buildWithId({
				school,
				roles: [roleFactory.buildWithId({ name: RoleName.TEACHER })],
			});
			const colleagueAccount = accountFactory.withUser(colleagueUser).build();

			const { roomOwnerRole, roomEditorRole, roomViewerRole } = RoomRolesTestFactory.createRoomRoles();

			const userGroup = groupEntityFactory.buildWithId({
				type: GroupEntityTypes.ROOM,
				users: [
					{ user: ownerUser, role: roomOwnerRole },
					{ user: teacherUser, role: roomEditorRole },
					// the colleague is a plain room viewer, same board role a student would have -
					// only the TEACHER school role tells them apart
					{ user: colleagueUser, role: roomViewerRole },
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
					colleagueAccount,
					colleagueUser,
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
				.build({ dueDate: undefined, graceMinutes: undefined, maxPoints: 10 });
			const roomContent = roomContentEntityFactory.build({
				roomId: room.id,
				items: [{ id: columnBoardNode.id, type: RoomContentType.BOARD }],
			});
			await em.persist([columnBoardNode, columnNode, cardNode, assignmentElementNode, roomContent]).flush();
			em.clear();

			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);
			const colleagueClient = await new TestApiClientBuilder(app, baseRouteName).build(colleagueAccount);

			// the colleague, despite being a room "viewer", must not be offered a submission
			// prompt - the assignments list must be empty for them
			const colleagueAssignmentsList = await colleagueClient.get('');
			expect((colleagueAssignmentsList.body as AssignmentListResponse).assignments).toHaveLength(0);

			// and the teacher's submission overview must not list the colleague as a student
			// expected to submit something
			const teacherSubmissions = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const entries = (teacherSubmissions.body as AssignmentSubmissionListResponse).submissions;
			expect(entries.find((entry) => entry.userId === colleagueUser.id)).toBeUndefined();
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

		it('should reject withdrawing an already-submitted submission', async () => {
			const { studentAccount, assignmentElementNode } = await setup({
				dueDate: new Date('2020-01-01T00:00:00.000Z'),
				graceMinutes: 0,
			});
			// created directly (not via the API, which would itself reject a submission past the
			// deadline) to simulate a submission that was made while the assignment was still open
			const submissionNode = assignmentSubmissionEntityFactory
				.withParent(assignmentElementNode)
				.build({ userId: String(studentAccount.userId), submittedAt: new Date('2019-12-31T00:00:00.000Z') });
			await em.persistAndFlush(submissionNode);
			em.clear();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);

			const response = await studentClient.delete(`submissions/${submissionNode.id}`);

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

	describe('rubric grading', () => {
		const criteria = [
			{ id: 'criterion-1', name: 'Content', maxPoints: 6 },
			{ id: 'criterion-2', name: 'Grammar', maxPoints: 4 },
		];

		it('should sum criterionPoints into points and persist them', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup({ criteria, maxPoints: 10 });

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const gradeResponse = await teacherClient.patch(`submissions/${submissionId}/grade`, {
				criterionPoints: [
					{ criterionId: 'criterion-1', points: 5 },
					{ criterionId: 'criterion-2', points: 3 },
				],
			});

			expect(gradeResponse.status).toEqual(200);
			expect((gradeResponse.body as AssignmentSubmissionResponse).points).toEqual(8);
			expect((gradeResponse.body as AssignmentSubmissionResponse).criterionPoints).toEqual([
				{ criterionId: 'criterion-1', points: 5 },
				{ criterionId: 'criterion-2', points: 3 },
			]);

			// the list response carries the rubric itself, for the grading UI
			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			expect((teacherList.body as AssignmentSubmissionListResponse).criteria).toEqual(criteria);
		});

		it('should reject criterionPoints for an unknown criterion', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup({ criteria, maxPoints: 10 });

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await teacherClient.patch(`submissions/${submissionId}/grade`, {
				criterionPoints: [
					{ criterionId: 'does-not-exist', points: 1 },
					{ criterionId: 'criterion-2', points: 1 },
				],
			});

			expect(response.status).toEqual(422);
		});

		it('should reject criterionPoints exceeding a criterion’s own max', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup({ criteria, maxPoints: 10 });

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await teacherClient.patch(`submissions/${submissionId}/grade`, {
				criterionPoints: [
					{ criterionId: 'criterion-1', points: 99 },
					{ criterionId: 'criterion-2', points: 1 },
				],
			});

			expect(response.status).toEqual(422);
		});

		it('should require criterionPoints once the assignment has a rubric', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup({ criteria, maxPoints: 10 });

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await teacherClient.patch(`submissions/${submissionId}/grade`, { points: 5 });

			expect(response.status).toEqual(422);
		});

		it('should keep flat-points grading unchanged for an assignment without a rubric', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const gradeResponse = await teacherClient.patch(`submissions/${submissionId}/grade`, { points: 7 });

			expect(gradeResponse.status).toEqual(200);
			expect((gradeResponse.body as AssignmentSubmissionResponse).points).toEqual(7);
			expect((gradeResponse.body as AssignmentSubmissionResponse).criterionPoints).toBeNull();
		});
	});

	describe('submission file versions', () => {
		it('should list every uploaded version, newest first, numbered oldest to newest', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const v1 = new FileDto({
				id: 'file-v1',
				name: 'essay-v1.pdf',
				parentType: 'boardnodes' as FileDto['parentType'],
				parentId: submissionId,
				createdAt: new Date('2020-01-01T00:00:00.000Z'),
				updatedAt: new Date('2020-01-01T00:00:00.000Z'),
			});
			const v2 = new FileDto({
				id: 'file-v2',
				name: 'essay-v2.pdf',
				parentType: 'boardnodes' as FileDto['parentType'],
				parentId: submissionId,
				createdAt: new Date('2020-01-02T00:00:00.000Z'),
				updatedAt: new Date('2020-01-02T00:00:00.000Z'),
			});
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([v1, v2]);
			await studentClient.patch(`submissions/${submissionId}/submit`);

			const ownList = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownEntry = (ownList.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownEntry.fileVersions?.map((f) => [f.name, f.version])).toEqual([
				['essay-v2.pdf', 2],
				['essay-v1.pdf', 1],
			]);

			// never withheld, unlike teacher feedback - visible before any return
			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntry = (teacherList.body as AssignmentSubmissionListResponse).submissions.find(
				(entry) => entry.id === submissionId
			);
			expect(teacherEntry?.fileVersions?.map((f) => f.name)).toEqual(['essay-v2.pdf', 'essay-v1.pdf']);
		});
	});

	describe('the optional student comment', () => {
		it('should store the comment on submit and show it to student and teacher', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);

			const submitResponse = await studentClient.patch(`submissions/${submissionId}/submit`, {
				comment: 'Das ist meine erste Version.',
			});
			expect(submitResponse.status).toEqual(200);
			expect((submitResponse.body as AssignmentSubmissionResponse).comment).toEqual('Das ist meine erste Version.');

			const ownList = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			expect((ownList.body as AssignmentSubmissionListResponse).submissions[0].comment).toEqual(
				'Das ist meine erste Version.'
			);

			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntry = (teacherList.body as AssignmentSubmissionListResponse).submissions.find(
				(entry) => entry.id === submissionId
			);
			expect(teacherEntry?.comment).toEqual('Das ist meine erste Version.');
		});

		it('should update the comment on a resubmit', async () => {
			const { studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);

			await studentClient.patch(`submissions/${submissionId}/submit`, { comment: 'v1' });
			await studentClient.patch(`submissions/${submissionId}/submit`, { comment: 'v2 - überarbeitet' });

			const ownList = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			expect((ownList.body as AssignmentSubmissionListResponse).submissions[0].comment).toEqual('v2 - überarbeitet');
		});

		it('should accept submitting without a comment', async () => {
			const { studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);

			const response = await studentClient.patch(`submissions/${submissionId}/submit`);

			expect(response.status).toEqual(200);
			expect((response.body as AssignmentSubmissionResponse).comment).toBeNull();
		});
	});

	describe('the teacher audio feedback', () => {
		const buildAudioFileDto = (parentId: string, name = 'feedback-audio-1.webm'): FileDto =>
			new FileDto({
				id: `audio-${name}`,
				name,
				parentType: 'boardnodes' as FileDto['parentType'],
				parentId,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

		it('should keep the submission file and the audio apart, for teacher and student', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			// the teacher's audio now lives on its own AssignmentFeedback child node - it must
			// exist before the teacher can be shown as having attached anything to it
			const containerResponse = await teacherClient.post(`submissions/${submissionId}/feedback-container`);
			const { feedbackContainerId } = containerResponse.body as { feedbackContainerId: string };

			filesStorageClientAdapterService.listFilesOfParent.mockImplementation((parentId: string) => {
				if (parentId === feedbackContainerId) {
					return Promise.resolve([buildAudioFileDto(feedbackContainerId)]);
				}
				return Promise.resolve([buildFileDto(submissionId)]);
			});
			await studentClient.patch(`submissions/${submissionId}/submit`);

			// teacher sees both
			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntry = (teacherList.body as AssignmentSubmissionListResponse).submissions.find(
				(entry) => entry.id === submissionId
			);
			expect(teacherEntry?.file?.name).toEqual('submission.pdf');
			expect(teacherEntry?.feedbackAudio?.name).toEqual('feedback-audio-1.webm');

			// the student does not get the audio before it has been returned
			const ownListBefore = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownBefore = (ownListBefore.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownBefore.file?.name).toEqual('submission.pdf');
			expect(ownBefore.feedbackAudio).toBeNull();

			// after the return, the audio is revealed
			await teacherClient.post(`submissions/${submissionId}/return`, { points: 5 });
			const ownListAfter = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownAfter = (ownListAfter.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownAfter.feedbackAudio?.name).toEqual('feedback-audio-1.webm');
		});

		// A5 regression: the submission node no longer classifies its own files by name (that
		// was the bug - a student-chosen name could accidentally, or deliberately, shadow the
		// teacher's feedback). A student's own upload is accepted regardless of what it is
		// named, including a name that used to collide with the feedback prefix.
		it('should accept a submission document even if its name looks like a feedback file', async () => {
			const { studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([
				buildAudioFileDto(submissionId, 'feedback-notizen.pdf'),
			]);
			const response = await studentClient.patch(`submissions/${submissionId}/submit`);

			expect(response.status).toEqual(200);
			expect((response.body as AssignmentSubmissionResponse).file?.name).toEqual('feedback-notizen.pdf');
		});
	});

	describe('the teacher feedback files (annotated corrections)', () => {
		const buildFeedbackFileDto = (parentId: string, name: string): FileDto =>
			new FileDto({
				id: `feedback-${name}`,
				name,
				parentType: 'boardnodes' as FileDto['parentType'],
				parentId,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

		it('should keep feedback files out of the submission document slot and release them with the return', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const containerResponse = await teacherClient.post(`submissions/${submissionId}/feedback-container`);
			const { feedbackContainerId } = containerResponse.body as { feedbackContainerId: string };

			filesStorageClientAdapterService.listFilesOfParent.mockImplementation((parentId: string) => {
				if (parentId === feedbackContainerId) {
					return Promise.resolve([
						buildFeedbackFileDto(feedbackContainerId, 'feedback-pdf-1.pdf'),
						buildFeedbackFileDto(feedbackContainerId, 'feedback-img-1.png'),
					]);
				}
				return Promise.resolve([buildFileDto(submissionId)]);
			});
			await studentClient.patch(`submissions/${submissionId}/submit`);

			// the teacher sees the corrections immediately, newest first
			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntry = (teacherList.body as AssignmentSubmissionListResponse).submissions.find(
				(entry) => entry.id === submissionId
			);
			expect(teacherEntry?.file?.name).toEqual('submission.pdf');
			expect(teacherEntry?.feedbackFiles?.map((file) => file.name)).toEqual([
				'feedback-pdf-1.pdf',
				'feedback-img-1.png',
			]);

			// the student does not get the corrections before the return
			const ownListBefore = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownBefore = (ownListBefore.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownBefore.file?.name).toEqual('submission.pdf');
			expect(ownBefore.feedbackFiles).toBeNull();

			// after the return, the corrections are revealed
			await teacherClient.post(`submissions/${submissionId}/return`, { points: 7 });
			const ownListAfter = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			const ownAfter = (ownListAfter.body as AssignmentSubmissionListResponse).submissions[0];
			expect(ownAfter.feedbackFiles?.map((file) => file.name)).toEqual(['feedback-pdf-1.pdf', 'feedback-img-1.png']);
		});
	});

	describe('the feedback container endpoint', () => {
		it('should be idempotent - repeated calls return the same container', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const first = await teacherClient.post(`submissions/${submissionId}/feedback-container`);
			const second = await teacherClient.post(`submissions/${submissionId}/feedback-container`);

			expect(first.status).toEqual(200);
			expect(second.status).toEqual(200);
			expect((second.body as { feedbackContainerId: string }).feedbackContainerId).toEqual(
				(first.body as { feedbackContainerId: string }).feedbackContainerId
			);
		});

		it('should reject a student (non-editor) from creating a feedback container', async () => {
			const { studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await studentClient.post(`submissions/${submissionId}/feedback-container`);

			expect(response.status).toEqual(403);
		});
	});

	describe('when the file storage is broken', () => {
		it('should still list submissions without the file instead of failing', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			await studentClient.post(`${assignmentElementNode.id}/submissions`);
			filesStorageClientAdapterService.listFilesOfParent.mockRejectedValue(new Error('storage broken'));

			const studentResponse = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			expect(studentResponse.status).toEqual(200);
			const ownEntries = (studentResponse.body as AssignmentSubmissionListResponse).submissions;
			expect(ownEntries).toHaveLength(1);
			expect(ownEntries[0].file).toBeNull();

			const teacherResponse = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			expect(teacherResponse.status).toEqual(200);
		});

		it('should reject submitting with a dedicated error when the file cannot be verified', async () => {
			const { studentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			filesStorageClientAdapterService.listFilesOfParent.mockRejectedValue(new Error('storage broken'));
			const response = await studentClient.patch(`submissions/${submissionId}/submit`);

			expect(response.status).toEqual(500);
			expect((response.body as { message: string }).message).toContain('could not be verified');
		});
	});

	describe('batch return', () => {
		it('should return graded submissions and report ungraded ones as failed, without aborting the batch', async () => {
			const { teacherAccount, studentAccount, otherStudentAccount, assignmentElementNode } = await setup();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const otherStudentClient = await new TestApiClientBuilder(app, baseRouteName).build(otherStudentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const gradedCreate = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const gradedSubmissionId = (gradedCreate.body as AssignmentSubmissionResponse).id as string;
			await teacherClient.patch(`submissions/${gradedSubmissionId}/grade`, { points: 8 });

			const ungradedCreate = await otherStudentClient.post(`${assignmentElementNode.id}/submissions`);
			const ungradedSubmissionId = (ungradedCreate.body as AssignmentSubmissionResponse).id as string;

			const response = await teacherClient.post('submissions/return-batch', {
				submissionIds: [gradedSubmissionId, ungradedSubmissionId],
			});

			expect(response.status).toEqual(200);
			const body = response.body as BatchReturnSubmissionsResponse;
			expect(body.returned).toHaveLength(1);
			expect(body.returned[0].id).toEqual(gradedSubmissionId);
			expect(body.returned[0].status).toEqual('returned');
			expect(body.returned[0].points).toEqual(8);
			expect(body.failed).toHaveLength(1);
			expect(body.failed[0].submissionId).toEqual(ungradedSubmissionId);

			// the returned submission is now visible to its owner
			const ownList = await studentClient.get(`${assignmentElementNode.id}/submissions`);
			expect((ownList.body as AssignmentSubmissionListResponse).submissions[0].points).toEqual(8);

			// the ungraded one was left untouched
			const otherOwnList = await otherStudentClient.get(`${assignmentElementNode.id}/submissions`);
			expect((otherOwnList.body as AssignmentSubmissionListResponse).submissions[0].points).toBeNull();
		});

		it('should reject a batch return from a student', async () => {
			const { studentAccount, assignmentElementNode } = await setup();
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await studentClient.post('submissions/return-batch', { submissionIds: [submissionId] });

			const body = response.body as BatchReturnSubmissionsResponse;
			expect(response.status).toEqual(200);
			expect(body.returned).toHaveLength(0);
			expect(body.failed).toHaveLength(1);
			expect(body.failed[0].submissionId).toEqual(submissionId);
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

		it('should hide assignments that have not started yet from students, but show them to teachers', async () => {
			const { teacherAccount, studentAccount, assignmentElementNode } = await setup({
				startDate: new Date('2099-01-01T00:00:00.000Z'),
			});

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const studentResponse = await studentClient.get('');
			expect(studentResponse.status).toEqual(200);
			expect((studentResponse.body as AssignmentListResponse).assignments).toHaveLength(0);

			const teacherResponse = await teacherClient.get('');
			const teacherItems = teacherResponse.body as AssignmentListResponse;
			expect(teacherItems.assignments).toHaveLength(1);
			expect(teacherItems.assignments[0].id).toEqual(assignmentElementNode.id);
			expect(teacherItems.assignments[0].isStarted).toBe(false);
		});

		it('should not list assignments on draft boards for students, but list them for teachers', async () => {
			// draft boards (isVisible=false) reject findBoard for non-editors - a student
			// clicking such a list entry would land on the board 404 page
			const { teacherAccount, studentAccount, columnBoardNode } = await setup();
			const boardEntity = await em.findOne(BoardNodeEntity, { id: columnBoardNode.id });
			boardEntity!.isVisible = false;
			await em.persistAndFlush(boardEntity!);
			em.clear();

			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const studentResponse = await studentClient.get('');
			expect((studentResponse.body as AssignmentListResponse).assignments).toHaveLength(0);

			const teacherResponse = await teacherClient.get('');
			expect((teacherResponse.body as AssignmentListResponse).assignments).toHaveLength(1);
		});

		it('should not list assignments that live on a board the room no longer references', async () => {
			// a copied/replaced room can leave old boards behind that keep the room's context -
			// their assignments are unreachable through the room and must not surface here
			const { teacherAccount, columnBoardNode, room } = await setup();
			const orphanBoard = columnBoardEntityFactory.build({
				context: { id: room.id, type: BoardExternalReferenceType.Room },
			});
			const orphanColumn = columnEntityFactory.withParent(orphanBoard).build();
			const orphanCard = cardEntityFactory.withParent(orphanColumn).build();
			const orphanElement = assignmentElementEntityFactory.withParent(orphanCard).build();
			await em.persist([orphanBoard, orphanColumn, orphanCard, orphanElement]).flush();
			em.clear();

			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);
			const response = await teacherClient.get('');

			expect(response.status).toEqual(200);
			const items = (response.body as AssignmentListResponse).assignments;
			expect(items).toHaveLength(1);
			expect(items[0].id).not.toEqual(orphanElement.id);
			expect(items[0].boardId).toEqual(columnBoardNode.id);
		});
	});
});
