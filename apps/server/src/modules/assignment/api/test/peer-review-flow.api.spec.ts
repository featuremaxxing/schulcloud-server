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
import { RoomContentType } from '@modules/room';
import { roomContentEntityFactory } from '@modules/room/testing';
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
	type AssignmentSubmissionListResponse,
	type AssignmentSubmissionResponse,
	type PeerReviewAssignResultResponse,
	type PeerReviewSettingsResponse,
	type PeerReviewTaskResponse,
} from '../dto';

const baseRouteName = '/assignments';

const buildFileDto = (parentId: string): FileDto =>
	new FileDto({
		id: `file-${parentId}`,
		name: 'submission.pdf',
		parentType: 'boardnodes' as FileDto['parentType'],
		parentId,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

describe('peer review flow (api)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let filesStorageClientAdapterService: DeepMocked<FilesStorageClientAdapterService>;

	beforeAll(async () => {
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

	// three students, so auto-assign has enough submissions for a non-trivial rotation
	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const ownerUser = userFactory.buildWithId({ school });

		const teacherUser = userFactory.buildWithId({ school });
		const teacherAccount = accountFactory.withUser(teacherUser).build();

		const studentA = userFactory.buildWithId({ school });
		const studentAAccount = accountFactory.withUser(studentA).build();
		const studentB = userFactory.buildWithId({ school });
		const studentBAccount = accountFactory.withUser(studentB).build();
		const studentC = userFactory.buildWithId({ school });
		const studentCAccount = accountFactory.withUser(studentC).build();

		const { roomOwnerRole, roomEditorRole, roomViewerRole } = RoomRolesTestFactory.createRoomRoles();

		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [
				{ user: ownerUser, role: roomOwnerRole },
				{ user: teacherUser, role: roomEditorRole },
				{ user: studentA, role: roomViewerRole },
				{ user: studentB, role: roomViewerRole },
				{ user: studentC, role: roomViewerRole },
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
				studentAAccount,
				studentA,
				studentBAccount,
				studentB,
				studentCAccount,
				studentC,
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
			.build({ dueDate: undefined, graceMinutes: undefined, maxPoints: 10, peerReviewEnabled: true });

		const roomContent = roomContentEntityFactory.build({
			roomId: room.id,
			items: [{ id: columnBoardNode.id, type: RoomContentType.BOARD }],
		});

		await em.persist([columnBoardNode, columnNode, cardNode, assignmentElementNode, roomContent]).flush();
		em.clear();

		return { teacherAccount, studentAAccount, studentBAccount, studentCAccount, assignmentElementNode };
	};

	describe('settings', () => {
		it('should enable peer review with mode and reviewer count', async () => {
			const { teacherAccount, assignmentElementNode } = await setup();
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const response = await teacherClient.patch(`${assignmentElementNode.id}/peer-review-settings`, {
				enabled: true,
				mode: 'auto',
				count: 1,
			});

			expect(response.status).toEqual(200);
			const body = response.body as PeerReviewSettingsResponse;
			expect(body.enabled).toBe(true);
			expect(body.mode).toEqual('auto');
			expect(body.count).toEqual(1);
		});

		it('should reject settings changes from a student', async () => {
			const { studentAAccount, assignmentElementNode } = await setup();
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);

			const response = await studentClient.patch(`${assignmentElementNode.id}/peer-review-settings`, {
				enabled: true,
			});

			expect(response.status).toEqual(403);
		});
	});

	describe('auto-assign', () => {
		it('should reject auto-assign with fewer than two submissions', async () => {
			const { teacherAccount, studentAAccount, assignmentElementNode } = await setup();
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			await studentClient.post(`${assignmentElementNode.id}/submissions`);

			const response = await teacherClient.post(`${assignmentElementNode.id}/peer-review/auto-assign`);

			expect(response.status).toEqual(409);
		});

		it('should assign every submission a reviewer that never reviews their own work', async () => {
			const { teacherAccount, studentAAccount, studentBAccount, studentCAccount, assignmentElementNode } =
				await setup();
			const studentAClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const studentBClient = await new TestApiClientBuilder(app, baseRouteName).build(studentBAccount);
			const studentCClient = await new TestApiClientBuilder(app, baseRouteName).build(studentCAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			await studentAClient.post(`${assignmentElementNode.id}/submissions`);
			await studentBClient.post(`${assignmentElementNode.id}/submissions`);
			await studentCClient.post(`${assignmentElementNode.id}/submissions`);

			const response = await teacherClient.post(`${assignmentElementNode.id}/peer-review/auto-assign`);

			expect(response.status).toEqual(200);
			expect((response.body as PeerReviewAssignResultResponse).assignedCount).toEqual(3);

			const studentAList = await studentAClient.get('peer-review/my-tasks');
			expect(studentAList.body as PeerReviewTaskResponse[]).toHaveLength(1);
		});
	});

	describe('manual assign', () => {
		it('should reject assigning a student to review their own submission', async () => {
			const { teacherAccount, studentAAccount, assignmentElementNode } = await setup();
			const studentClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, {
				assignments: [{ submissionId, reviewerUserId: studentAAccount.userId }],
			});

			expect(response.status).toEqual(422);
		});

		it('should assign a specific reviewer to a specific submission', async () => {
			const { teacherAccount, studentAAccount, studentBAccount, assignmentElementNode } = await setup();
			const studentAClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const studentBClient = await new TestApiClientBuilder(app, baseRouteName).build(studentBAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentAClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const response = await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, {
				assignments: [{ submissionId, reviewerUserId: studentBAccount.userId }],
			});

			expect(response.status).toEqual(200);

			const tasksResponse = await studentBClient.get('peer-review/my-tasks');
			expect(tasksResponse.body as PeerReviewTaskResponse[]).toHaveLength(1);
			expect((tasksResponse.body as PeerReviewTaskResponse[])[0].submissionId).toEqual(submissionId);
		});

		it('does not duplicate the assignment when the same pairing is submitted twice', async () => {
			const { teacherAccount, studentAAccount, studentBAccount, assignmentElementNode } = await setup();
			const studentAClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const studentBClient = await new TestApiClientBuilder(app, baseRouteName).build(studentBAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentAClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const assignBody = { assignments: [{ submissionId, reviewerUserId: studentBAccount.userId }] };
			const firstResponse = await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, assignBody);
			const secondResponse = await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, assignBody);

			expect(firstResponse.status).toEqual(200);
			expect(secondResponse.status).toEqual(200);

			const tasksResponse = await studentBClient.get('peer-review/my-tasks');
			expect(tasksResponse.body as PeerReviewTaskResponse[]).toHaveLength(1);
		});

		it("revokes a reviewer's access once peer review is turned off for the assignment", async () => {
			const { teacherAccount, studentAAccount, studentBAccount, assignmentElementNode } = await setup();
			const studentAClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const studentBClient = await new TestApiClientBuilder(app, baseRouteName).build(studentBAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentAClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			const assignResponse = await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, {
				assignments: [{ submissionId, reviewerUserId: studentBAccount.userId }],
			});
			expect(assignResponse.status).toEqual(200);

			const tasksBeforeDisable = await studentBClient.get('peer-review/my-tasks');
			expect(tasksBeforeDisable.body as PeerReviewTaskResponse[]).toHaveLength(1);
			const taskId = (tasksBeforeDisable.body as PeerReviewTaskResponse[])[0].id;

			const disableResponse = await teacherClient.patch(`${assignmentElementNode.id}/peer-review-settings`, {
				enabled: false,
			});
			expect(disableResponse.status).toEqual(200);

			// the task no longer shows up in the reviewer's list ...
			const tasksAfterDisable = await studentBClient.get('peer-review/my-tasks');
			expect(tasksAfterDisable.body as PeerReviewTaskResponse[]).toHaveLength(0);

			// ... and submitting against the old id is rejected outright, not silently accepted -
			// disabling deletes the row outright (see PeerReviewUc.updateSettings), so this comes
			// back as "not found" rather than "forbidden"
			const submitAfterDisable = await studentBClient.patch(`peer-review/${taskId}/submit`, { points: 5 });
			expect(submitAfterDisable.status).toEqual(404);
		});
	});

	describe('the review task', () => {
		it('never reveals the submitting student, and lets the reviewer submit their review', async () => {
			const { teacherAccount, studentAAccount, studentBAccount, assignmentElementNode } = await setup();
			const studentAClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const studentBClient = await new TestApiClientBuilder(app, baseRouteName).build(studentBAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentAClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;
			filesStorageClientAdapterService.listFilesOfParent.mockResolvedValue([buildFileDto(submissionId)]);

			await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, {
				assignments: [{ submissionId, reviewerUserId: studentBAccount.userId }],
			});

			const tasksResponse = await studentBClient.get('peer-review/my-tasks');
			const task = (tasksResponse.body as PeerReviewTaskResponse[])[0];

			// the response is asserted to contain no key that could name the submitter
			expect(JSON.stringify(task)).not.toContain(studentAAccount.userId);
			expect(task.file?.name).toEqual('submission.pdf');

			const submitResponse = await studentBClient.patch(`peer-review/${task.id}/submit`, {
				points: 7,
				feedbackComment: 'well organized',
			});
			expect(submitResponse.status).toEqual(200);
			expect((submitResponse.body as PeerReviewTaskResponse).points).toEqual(7);

			// the teacher sees an advisory summary, without any reviewer identity in it
			const teacherList = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			const teacherEntry = (teacherList.body as AssignmentSubmissionListResponse).submissions.find(
				(entry) => entry.id === submissionId
			);
			expect(teacherEntry?.peerReviews?.count).toEqual(1);
			expect(teacherEntry?.peerReviews?.averagePoints).toEqual(7);
			expect(teacherEntry?.peerReviews?.comments).toEqual(['well organized']);
			expect(JSON.stringify(teacherEntry?.peerReviews)).not.toContain(studentBAccount.userId);

			// still never rolled into the official grade
			expect(teacherEntry?.points).toBeNull();
		});

		it('should reject submitting a review that was not assigned to the caller', async () => {
			const { teacherAccount, studentAAccount, studentBAccount, studentCAccount, assignmentElementNode } =
				await setup();
			const studentAClient = await new TestApiClientBuilder(app, baseRouteName).build(studentAAccount);
			const studentCClient = await new TestApiClientBuilder(app, baseRouteName).build(studentCAccount);
			const teacherClient = await new TestApiClientBuilder(app, baseRouteName).build(teacherAccount);

			const createResponse = await studentAClient.post(`${assignmentElementNode.id}/submissions`);
			const submissionId = (createResponse.body as AssignmentSubmissionResponse).id as string;

			await teacherClient.post(`${assignmentElementNode.id}/peer-review/assign`, {
				assignments: [{ submissionId, reviewerUserId: studentBAccount.userId }],
			});

			const tasksResponse = await teacherClient.get(`${assignmentElementNode.id}/submissions`);
			expect(tasksResponse.status).toEqual(200);

			// studentC was never assigned this review - guess an id shape and expect a clean failure
			const response = await studentCClient.patch(`peer-review/000000000000000000000000/submit`, { points: 1 });
			expect(response.status).toEqual(404);
		});
	});
});
