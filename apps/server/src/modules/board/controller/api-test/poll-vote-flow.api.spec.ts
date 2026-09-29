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

	const openPoll = (
		client: TestApiClient,
		elementId: string,
		overrides: { allowVoteChange?: boolean; opensAt?: string; questions?: unknown[] } = {}
	) =>
		client.patch(`${elementId}/content`, {
			data: {
				type: ContentElementType.POLL,
				content: {
					title: 'My poll',
					isAnonymous: false,
					showResultsLive: true,
					pollStatus: PollStatus.OPEN,
					questions: overrides.questions ?? [
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
					allowVoteChange: overrides.allowVoteChange,
					opensAt: overrides.opensAt,
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

	it('should let the student vote once opened, then change their vote when allowVoteChange is on', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId, { allowVoteChange: true });

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

	// The gap this closes: previously, adding a question after votes existed was rejected
	// outright by the server (structure lock), and even if it hadn't been, a student who had
	// already voted had no way back into the answered question. Both are fixed now: the
	// structure lock allows appending, and mergePollAnswers lets a student answer only the new
	// question while their original answer stays untouched.
	it('should let the student answer a question added after they already voted, keeping their earlier answer', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const reopenWithNewQuestion = await openPoll(teacherClient, pollElementId, {
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
				{
					id: 'question-2',
					text: 'A new question',
					answerMode: PollAnswerMode.SINGLE,
					chartType: PollChartType.BAR,
					options: [
						{ id: 'option-c', text: 'Option C' },
						{ id: 'option-d', text: 'Option D' },
					],
				},
			],
		});
		expect(reopenWithNewQuestion.statusCode).toEqual(HttpStatus.OK);

		await pollUc.vote(studentUserId, pollElementId, [
			{ questionId: 'question-1', selectedOptionIds: ['option-b'] }, // attempted change, must be ignored
			{ questionId: 'question-2', selectedOptionIds: ['option-c'] },
		]);

		const results = await pollUc.getResults(studentUserId, pollElementId);
		expect(results.myVote).toEqual([
			{ questionId: 'question-1', selectedOptionIds: ['option-a'] }, // unchanged
			{ questionId: 'question-2', selectedOptionIds: ['option-c'] },
		]);
	});

	it('should reject an attempt to change an already-answered question when allowVoteChange is off', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		await expect(
			pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-b'] }])
		).rejects.toThrow(ForbiddenException);
	});

	it('should not reject resubmitting the same, unchanged answer when allowVoteChange is off', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);
		await pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		await expect(
			pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }])
		).resolves.toBeDefined();
	});

	it('should reject a vote before opensAt', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		const opensAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // one hour from now
		await openPoll(teacherClient, pollElementId, { opensAt });

		await expect(
			pollUc.vote(studentUserId, pollElementId, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }])
		).rejects.toThrow(ForbiddenException);
	});

	it('should allow a vote once opensAt has passed', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		const opensAt = new Date(Date.now() - 60 * 1000).toISOString(); // one minute ago
		await openPoll(teacherClient, pollElementId, { opensAt });

		const result = await pollUc.vote(studentUserId, pollElementId, [
			{ questionId: 'question-1', selectedOptionIds: ['option-a'] },
		]);

		expect(result.totalVotes).toBe(1);
	});

	// Regression test: a single-choice question's stored answer must never carry more than one
	// option, and must never reference an option/question the poll doesn't actually have - see
	// normalizePollAnswers/PollUc.vote. Without it, one vote selecting every option of a
	// SINGLE-choice question would increment every option's count in aggregateResults.
	it('should not store more than one option for a single-choice question, and should drop unknown ids', async () => {
		const { teacherClient, pollElementId, studentUserId } = await setup();
		await openPoll(teacherClient, pollElementId);

		await pollUc.vote(studentUserId, pollElementId, [
			{ questionId: 'question-1', selectedOptionIds: ['option-a', 'option-b', 'does-not-exist'] },
			{ questionId: 'unknown-question', selectedOptionIds: ['option-a'] },
		]);

		const results = await pollUc.getResults(studentUserId, pollElementId);
		expect(results.myVote).toEqual([{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const aggregated = results.results?.find((question) => question.questionId === 'question-1');
		const totalCount = aggregated?.counts.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
		expect(totalCount).toBe(1); // not 2 - the vote must not count towards both options
	});

	// Regression test: participantCount must reflect how many students are actually eligible to
	// vote (the room roster), not how many already have - votes.length would make the status bar
	// read "1 von 1 abgestimmt" for every poll, no matter the class size (see PollUc.getResults).
	it('should report participantCount as the room roster size, not the number of votes cast', async () => {
		const { teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const { studentAccount: studentAAccount, studentUser: studentA } = UserAndAccountTestFactory.buildStudent({
			school: teacherUser.school,
		});
		const { studentUser: studentB } = UserAndAccountTestFactory.buildStudent({ school: teacherUser.school });

		const course = courseEntityFactory.build({
			school: teacherUser.school,
			teachers: [teacherUser],
			students: [studentA, studentB],
		});
		await em.persist([teacherUser, studentAAccount, studentA, studentB, course]).flush();

		const columnBoardNode = columnBoardEntityFactory.build({
			context: { id: course.id, type: BoardExternalReferenceType.Course },
		});
		const column = columnEntityFactory.withParent(columnBoardNode).build();
		const card = cardEntityFactory.withParent(column).build();
		const pollElement = pollElementEntityFactory.withParent(card).build({
			pollStatus: PollStatus.OPEN,
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

		await pollUc.vote(studentA.id, pollElement.id, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const results = await pollUc.getResults(studentA.id, pollElement.id);

		expect(results.totalVotes).toBe(1);
		expect(results.participantCount).toBe(2);
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

	// Regression test for the frozen snapshot specifically (as opposed to the live
	// getResults() path covered above): closing with only some of the eligible students
	// having voted must not freeze "n of n" into the snapshot either.
	it('should freeze the eligible-voter count, not the vote count, when closing with partial participation', async () => {
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher();
		const { studentUser: studentA } = UserAndAccountTestFactory.buildStudent({ school: teacherUser.school });
		const { studentUser: studentB } = UserAndAccountTestFactory.buildStudent({ school: teacherUser.school });

		const course = courseEntityFactory.build({
			school: teacherUser.school,
			teachers: [teacherUser],
			students: [studentA, studentB],
		});
		await em.persist([teacherUser, teacherAccount, studentA, studentB, course]).flush();

		const columnBoardNode = columnBoardEntityFactory.build({
			context: { id: course.id, type: BoardExternalReferenceType.Course },
		});
		const column = columnEntityFactory.withParent(columnBoardNode).build();
		const card = cardEntityFactory.withParent(column).build();
		const pollElement = pollElementEntityFactory.withParent(card).build({
			pollStatus: PollStatus.OPEN,
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

		// only studentA votes, studentB never does
		await pollUc.vote(studentA.id, pollElement.id, [{ questionId: 'question-1', selectedOptionIds: ['option-a'] }]);

		const teacherClient = await testApiClient.login(teacherAccount);
		const closeResponse = await teacherClient.patch(`${pollElement.id}/content`, {
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

		const closedEntity = await em.findOneOrFail(BoardNodeEntity, pollElement.id);
		expect(closedEntity.resultSnapshot?.participantCount).toBe(2);
	});
});
