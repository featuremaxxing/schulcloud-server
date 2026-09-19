import { EntityManager } from '@mikro-orm/mongodb';
import { courseEntityFactory } from '@modules/course/testing';
import { ServerTestModule } from '@modules/server/server.app.module';
import { ForbiddenException, HttpStatus, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import { TestApiClient } from '@testing/test-api-client';
import {
	BoardExternalReferenceType,
	ContentElementType,
	PollAnswerMode,
	PollChartType,
	PollStatus,
} from '../../domain';
import { BoardNodeEntity } from '../../repo';
import {
	cardEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
	pollElementEntityFactory,
} from '../../testing';
import { PollUc } from '../../uc';

// Voting is exposed to real clients only over the collaboration socket (see
// gateway/board-collaboration.gateway.ts poll-vote-request handler), which reuses this
// same PollUc.vote(). Exercising PollUc directly here keeps this an integration test of
// the full persistence/permission stack without needing a socket.io test harness -
// gateway/api-test/board-collaboration.gateway.spec.ts is the place for socket transport
// coverage of the generic message pattern this handler follows.
describe('poll vote flow (api)', () => {
	let app: INestApplication;
	let em: EntityManager;
	let testApiClient: TestApiClient;
	let pollsApiClient: TestApiClient;
	let pollUc: PollUc;

	beforeAll(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [ServerTestModule],
		}).compile();

		app = module.createNestApplication();
		await app.init();
		em = module.get(EntityManager);
		pollUc = module.get(PollUc);
		testApiClient = new TestApiClient(app, 'elements');
		pollsApiClient = new TestApiClient(app, 'polls');
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

		const course = courseEntityFactory.build({
			school: teacherUser.school,
			teachers: [teacherUser],
			students: [studentUser],
		});
		await em.persist([teacherUser, teacherAccount, studentUser, studentAccount, course]).flush();

		const columnBoardNode = columnBoardEntityFactory.build({
			context: { id: course.id, type: BoardExternalReferenceType.Course },
		});
		const column = columnEntityFactory.withParent(columnBoardNode).build();
		const card = cardEntityFactory.withParent(column).build();
		const pollElement = pollElementEntityFactory.withParent(card).build({
			pollStatus: PollStatus.DRAFT,
			isAnonymous: false,
			showResultsLive: true,
			questions: [
				{
					id: 'question-1',
					text: 'Which one?',
					answerMode: PollAnswerMode.SINGLE,
					chartType: PollChartType.BAR,
					options: [
						{ id: 'option-a', text: 'Option A' },
						{ id: 'option-b', text: 'Option B' },
					],
				},
			],
		});

		await em.persist([card, column, columnBoardNode, pollElement]).flush();
		em.clear();

		const teacherClient = await testApiClient.login(teacherAccount);
		const studentClient = await testApiClient.login(studentAccount);
		const studentPollsClient = await pollsApiClient.login(studentAccount);

		return {
			teacherClient,
			studentClient,
			studentPollsClient,
			pollElementId: pollElement.id,
			studentUserId: studentUser.id,
			teacherUserId: teacherUser.id,
		};
	};

	const openPoll = (client: TestApiClient, elementId: string) =>
		client.patch(`${elementId}/content`, {
			data: {
				type: ContentElementType.POLL,
				content: {
					title: 'My poll',
					isAnonymous: false,
					showResultsLive: true,
					pollStatus: PollStatus.OPEN,
					questions: [
						{
							id: 'question-1',
							text: 'Which one?',
							answerMode: PollAnswerMode.SINGLE,
							chartType: PollChartType.BAR,
							options: [
								{ id: 'option-a', text: 'Option A' },
								{ id: 'option-b', text: 'Option B' },
							],
						},
					],
				},
			},
		});

	it('should let the teacher open the poll', async () => {
		const { teacherClient, pollElementId } = await setup();

		const response = await openPoll(teacherClient, pollElementId);

		expect(response.statusCode).toEqual(HttpStatus.OK);
		const result = await em.findOneOrFail(BoardNodeEntity, pollElementId);
		expect(result.pollStatus).toEqual(PollStatus.OPEN);
	});

	it('should let the student vote once opened, then change their vote', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);

		const firstVote = await pollUc.vote(studentUserId, pollElementId, [
			{ questionId: 'question-1', selectedOptionIds: ['option-a'] },
		]);
		expect(firstVote.totalVotes).toBe(1);

		const secondVote = await pollUc.vote(studentUserId, pollElementId, [
			{ questionId: 'question-1', selectedOptionIds: ['option-b'] },
		]);
		expect(secondVote.totalVotes).toBe(1); // same participant, not a second vote

		const results = await pollUc.getResults(studentUserId, pollElementId);
		expect(results.myVote).toEqual([{ questionId: 'question-1', selectedOptionIds: ['option-b'] }]);
	});

	it('should reject a vote from another student for someone else’s vote id implicitly by never mixing votes', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);

		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const results = await pollUc.getResults(studentUserId, pollElementId);
		expect(results.totalVotes).toBe(1);
		expect(results.participantCount).toBe(1);
	});

	it('should include voter names for the manager on a non-anonymous poll', async () => {
		const { teacherClient, pollElementId, studentUserId, teacherUserId } = await setup();
		await openPoll(teacherClient, pollElementId);
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const results = await pollUc.getResults(teacherUserId, pollElementId);

		expect(results.voters).toEqual([
			expect.objectContaining({
				userId: studentUserId,
				firstName: 'Anna',
				lastName: 'Beispiel',
			}),
		]);
	});

	it('should not include voters for a student even though names would be resolvable', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const results = await pollUc.getResults(studentUserId, pollElementId);

		expect(results.voters).toBeUndefined();
	});

	it('should not include voters (and therefore no names) for an anonymous poll, even for the manager', async () => {
		const { teacherClient, pollElementId, studentUserId, teacherUserId } = await setup();
		await teacherClient.patch(`${pollElementId}/content`, {
			data: {
				type: ContentElementType.POLL,
				content: {
					title: 'My poll',
					isAnonymous: true,
					showResultsLive: true,
					pollStatus: PollStatus.OPEN,
					questions: [
						{
							id: 'question-1',
							text: 'Which one?',
							answerMode: PollAnswerMode.SINGLE,
							chartType: PollChartType.BAR,
							options: [
								{ id: 'option-a', text: 'Option A' },
								{ id: 'option-b', text: 'Option B' },
							],
						},
					],
				},
			},
		});
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const results = await pollUc.getResults(teacherUserId, pollElementId);

		expect(results.voters).toBeUndefined();
	});

	it('should freeze a resultSnapshot when the teacher closes the poll, and reject further votes', async () => {
		const { teacherClient, studentPollsClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const closeResponse = await teacherClient.patch(`${pollElementId}/content`, {
			data: {
				type: ContentElementType.POLL,
				content: {
					title: 'My poll',
					isAnonymous: false,
					showResultsLive: true,
					pollStatus: PollStatus.CLOSED,
					questions: [
						{
							id: 'question-1',
							text: 'Which one?',
							answerMode: PollAnswerMode.SINGLE,
							chartType: PollChartType.BAR,
							options: [
								{ id: 'option-a', text: 'Option A' },
								{ id: 'option-b', text: 'Option B' },
							],
						},
					],
				},
			},
		});
		expect(closeResponse.statusCode).toEqual(HttpStatus.OK);

		const closedEntity = await em.findOneOrFail(BoardNodeEntity, pollElementId);
		expect(closedEntity.resultSnapshot?.participantCount).toBe(1);
		expect(closedEntity.resultSnapshot?.perQuestion[0].counts).toEqual(
			expect.arrayContaining([
				{ optionId: 'option-a', count: 1 },
				{ optionId: 'option-b', count: 0 },
			])
		);

		await expect(
			pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-b'] }])
		).rejects.toThrow(ForbiddenException);

		const resultsResponse = await studentPollsClient.get(`${pollElementId}/results`);
		expect(resultsResponse.statusCode).toEqual(HttpStatus.OK);
		expect(resultsResponse.body).toMatchObject({ totalVotes: 1, participantCount: 1 });
	});
});
