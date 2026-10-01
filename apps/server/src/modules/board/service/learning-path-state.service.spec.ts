import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { Test, type TestingModule } from '@nestjs/testing';
import { BOARD_CONFIG_TOKEN } from '../board.config';
import {
	BoardExternalReferenceType,
	BoardLayout,
	BoardRoles,
	type ColumnBoard,
	type LearningPathStep,
	type UserWithBoardRoles,
} from '../domain';
import {
	BoardCompletionEntity,
	BoardCompletionRepo,
	BoardNodeRepo,
	LearningPathEnrollmentEntity,
	LearningPathEnrollmentRepo,
} from '../repo';
import { columnBoardFactory, learningPathStepFactory } from '../testing';
import { BoardNodeService } from './board-node.service';
import { BoardProgressService } from './board-progress.service';
import { LearningPathStateService } from './learning-path-state.service';

describe(LearningPathStateService.name, () => {
	let module: TestingModule;
	let service: LearningPathStateService;
	let boardNodeRepo: DeepMocked<BoardNodeRepo>;
	let boardNodeService: DeepMocked<BoardNodeService>;
	let boardProgressService: DeepMocked<BoardProgressService>;
	let boardCompletionRepo: DeepMocked<BoardCompletionRepo>;
	let enrollmentRepo: DeepMocked<LearningPathEnrollmentRepo>;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				LearningPathStateService,
				{ provide: BoardNodeRepo, useValue: createMock<BoardNodeRepo>() },
				{ provide: BoardNodeService, useValue: createMock<BoardNodeService>() },
				{ provide: BoardProgressService, useValue: createMock<BoardProgressService>() },
				{ provide: BoardCompletionRepo, useValue: createMock<BoardCompletionRepo>() },
				{ provide: LearningPathEnrollmentRepo, useValue: createMock<LearningPathEnrollmentRepo>() },
				{
					provide: BOARD_CONFIG_TOKEN,
					useValue: {
						featureBoardLearningPathEnabled: true,
						featureColumnBoardCheckboxEnabled: true,
						featureColumnBoardAssignmentEnabled: true,
						featureColumnBoardPollEnabled: true,
					},
				},
			],
		}).compile();

		service = module.get(LearningPathStateService);
		boardNodeRepo = module.get(BoardNodeRepo);
		boardNodeService = module.get(BoardNodeService);
		boardProgressService = module.get(BoardProgressService);
		boardCompletionRepo = module.get(BoardCompletionRepo);
		enrollmentRepo = module.get(LearningPathEnrollmentRepo);
	});

	afterEach(() => {
		jest.resetAllMocks();
	});

	afterAll(async () => {
		await module.close();
	});

	// A -> C, B -> C ; C locked until prerequisites are done
	const buildPath = (unlockMode: 'all' | 'any') => {
		const boardA = columnBoardFactory.build({ isVisible: true });
		const boardB = columnBoardFactory.build({ isVisible: true });
		const boardC = columnBoardFactory.build({ isVisible: true });
		const pathId = new ObjectId().toHexString();
		const path = `,${pathId},`;
		const a = learningPathStepFactory.build({ linkedBoardId: boardA.id, path, level: 1 });
		const b = learningPathStepFactory.build({ linkedBoardId: boardB.id, path, level: 1 });
		const c = learningPathStepFactory.build({
			path,
			level: 1,
			linkedBoardId: boardC.id,
			prerequisiteStepIds: [a.id, b.id],
			unlockMode,
			lockUntilPrerequisitesDone: true,
		});
		const linkedBoards = new Map<string, ColumnBoard>([boardA, boardB, boardC].map((board) => [board.id, board]));
		const userId = new ObjectId().toHexString();

		return { boardA, boardB, boardC, a, b, c, linkedBoards, userId, pathId };
	};

	// completed for good: done now and unlocking what follows
	const doneBy = (boardId: string, userId: string) => {
		return { done: new Map([[boardId, new Set([userId])]]), unlocked: new Map([[boardId, new Set([userId])]]) };
	};

	describe('computeStates', () => {
		it('should lock a step until all prerequisites are done', () => {
			const { a, b, c, boardA, linkedBoards, userId } = buildPath('all');
			const completed = doneBy(boardA.id, userId);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states.map((state) => state.status)).toEqual(['done', 'open', 'locked']);
		});

		it('should open a step when one prerequisite is enough', () => {
			const { a, b, c, boardA, linkedBoards, userId } = buildPath('any');
			const completed = doneBy(boardA.id, userId);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states[2].status).toBe('open');
		});

		it('should not block on a prerequisite whose board is still a draft', () => {
			const { a, b, c, boardA, boardB, linkedBoards, userId } = buildPath('all');
			boardB.isVisible = false;
			const completed = doneBy(boardA.id, userId);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states.map((state) => state.status)).toEqual(['done', 'unavailable', 'open']);
		});

		it('should not block on a prerequisite whose board is gone', () => {
			const { a, b, c, boardA, boardB, linkedBoards, userId } = buildPath('all');
			linkedBoards.delete(boardB.id);
			const completed = doneBy(boardA.id, userId);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states[2].status).toBe('open');
		});

		it('should leave a step open when locking is off', () => {
			const { a, b, c, linkedBoards, userId } = buildPath('all');
			c.lockUntilPrerequisitesDone = false;

			const states = service.computeStates([a, b, c], linkedBoards, { done: new Map(), unlocked: new Map() }, userId);

			expect(states[2].status).toBe('open');
		});
	});

	describe('computeStates when something new came up', () => {
		it('should reopen a completed board but keep what follows open', () => {
			const { a, b, c, boardA, boardB, linkedBoards, userId } = buildPath('all');
			// A was completed before, but is not done any more; B is done
			const completion = {
				done: new Map([[boardB.id, new Set([userId])]]),
				unlocked: new Map([
					[boardA.id, new Set([userId])],
					[boardB.id, new Set([userId])],
				]),
			};

			const states = service.computeStates([a, b, c], linkedBoards, completion, userId);

			expect(states.map((state) => state.status)).toEqual(['open', 'done', 'open']);
			expect(states.map((state) => state.reopened)).toEqual([true, false, false]);
		});

		it('should not call a board reopened that was never completed', () => {
			const { a, b, c, linkedBoards, userId } = buildPath('all');

			const states = service.computeStates([a, b, c], linkedBoards, { done: new Map(), unlocked: new Map() }, userId);

			expect(states.some((state) => state.reopened)).toBe(false);
		});
	});

	describe('completionState', () => {
		const setup = () => {
			const { boardA, boardB, userId } = buildPath('all');
			const otherId = new ObjectId().toHexString();
			const completion = (boardId: string, id: string) =>
				new BoardCompletionEntity({ userId: id, boardId, completedAt: new Date(), source: 'manual' });

			return { boardA, boardB, userId, otherId, completion };
		};

		it('should count a stored completion on a board without progress items as done', async () => {
			const { boardA, boardB, userId, otherId, completion } = setup();
			boardProgressService.computeCompletedUserIds.mockResolvedValueOnce({
				done: new Map([
					[boardA.id, new Set([userId])],
					[boardB.id, new Set<string>()],
				]),
				withItems: new Map([
					[boardA.id, new Set([userId])],
					[boardB.id, new Set<string>()],
				]),
			});
			boardCompletionRepo.findByBoardIds.mockResolvedValueOnce([completion(boardB.id, otherId)]);

			const result = await service.completionState([boardA, boardB], []);

			expect(result.done.get(boardA.id)).toEqual(new Set([userId]));
			expect(result.done.get(boardB.id)).toEqual(new Set([otherId]));
			expect(result.unlocked.get(boardB.id)).toEqual(new Set([otherId]));
		});

		it('should keep a stored completion unlocking when new progress items are not done', async () => {
			const { boardA, userId, completion } = setup();
			// the person completed A, then the teacher added a checkbox they have not ticked
			boardProgressService.computeCompletedUserIds.mockResolvedValueOnce({
				done: new Map([[boardA.id, new Set<string>()]]),
				withItems: new Map([[boardA.id, new Set([userId])]]),
			});
			boardCompletionRepo.findByBoardIds.mockResolvedValueOnce([completion(boardA.id, userId)]);

			const result = await service.completionState([boardA], []);

			expect(result.done.get(boardA.id)?.has(userId)).toBe(false);
			expect(result.unlocked.get(boardA.id)?.has(userId)).toBe(true);
		});
	});

	// A room with a blue and a green learning path. Both lead to C and keep it closed:
	// blue: A -> C, green: B -> C.
	describe('learning paths of a room', () => {
		const setup = (options: { greenPublished?: boolean } = {}) => {
			const roomId = new ObjectId().toHexString();
			const context = { type: BoardExternalReferenceType.Room, id: roomId };
			const boardA = columnBoardFactory.build({ title: 'A', isVisible: true, context });
			const boardB = columnBoardFactory.build({ title: 'B', isVisible: true, context });
			const boardC = columnBoardFactory.build({ title: 'C', isVisible: true, context });

			const buildPath = (title: string, build: (path: string) => LearningPathStep[], isVisible = true) => {
				const id = new ObjectId().toHexString();
				const children = build(`,${id},`);
				return columnBoardFactory.build({ id, title, layout: BoardLayout.LEARNING_PATH, isVisible, context, children });
			};
			const blue = buildPath('Blue', (path) => {
				const a = learningPathStepFactory.build({ path, level: 1, linkedBoardId: boardA.id });
				const c = learningPathStepFactory.build({
					path,
					level: 1,
					linkedBoardId: boardC.id,
					prerequisiteStepIds: [a.id],
					lockUntilPrerequisitesDone: true,
				});
				return [a, c];
			});
			const green = buildPath(
				'Green',
				(path) => {
					const b = learningPathStepFactory.build({ path, level: 1, linkedBoardId: boardB.id });
					const c = learningPathStepFactory.build({
						path,
						level: 1,
						linkedBoardId: boardC.id,
						prerequisiteStepIds: [b.id],
						lockUntilPrerequisitesDone: true,
					});
					return [b, c];
				},
				options.greenPublished ?? true
			);

			const teacher: UserWithBoardRoles = { userId: new ObjectId().toHexString(), roles: [BoardRoles.EDITOR] };
			const student: UserWithBoardRoles = { userId: new ObjectId().toHexString(), roles: [BoardRoles.READER] };
			const everything = [blue, green, boardA, boardB, boardC];

			boardNodeRepo.findLearningPathStepsLinking.mockResolvedValue(
				[blue, green].map((path) => path.children[1] as LearningPathStep)
			);
			boardNodeRepo.findByExternalReference.mockResolvedValue(everything);
			boardNodeService.findByIds.mockImplementation((ids: string[]) =>
				Promise.resolve(everything.filter((board) => ids.includes(board.id)))
			);
			boardProgressService.computeCompletedUserIds.mockResolvedValue({ done: new Map(), withItems: new Map() });
			boardCompletionRepo.findByBoardIds.mockResolvedValue([]);
			enrollmentRepo.findByRoom.mockResolvedValue([]);

			const enroll = (user: UserWithBoardRoles, ...paths: ColumnBoard[]) => {
				enrollmentRepo.findByRoom.mockResolvedValue(
					paths.map((path) => new LearningPathEnrollmentEntity({ userId: user.userId, pathBoardId: path.id, roomId }))
				);
			};
			const complete = (user: UserWithBoardRoles, ...boards: ColumnBoard[]) => {
				boardCompletionRepo.findByBoardIds.mockResolvedValue(
					boards.map(
						(board) =>
							new BoardCompletionEntity({
								userId: user.userId,
								boardId: board.id,
								completedAt: new Date(),
								source: 'manual',
							})
					)
				);
			};

			return { boardA, boardB, boardC, blue, green, teacher, student, enroll, complete };
		};

		describe('lockedUserIds', () => {
			it('should lock the board for students who did not complete the prerequisites', async () => {
				const { boardC, blue, teacher, student, enroll } = setup({ greenPublished: false });
				enroll(student, blue);

				const result = await service.lockedUserIds([boardC], [teacher, student]);

				expect(result.get(boardC.id)).toEqual([student.userId]);
			});

			it('should treat the only published learning path as the path everybody goes', async () => {
				const { boardC, teacher, student } = setup({ greenPublished: false });

				const result = await service.lockedUserIds([boardC], [teacher, student]);

				expect(result.get(boardC.id)).toEqual([student.userId]);
			});

			it('should not lock anything while the learning path is a draft', async () => {
				const { boardC, blue, teacher, student } = setup({ greenPublished: false });
				blue.isVisible = false;

				const result = await service.lockedUserIds([boardC], [teacher, student]);

				expect(result.size).toBe(0);
			});

			it('should only count the learning path a student goes', async () => {
				const { boardA, boardC, blue, teacher, student, enroll, complete } = setup();
				enroll(student, blue);
				complete(student, boardA);

				const result = await service.lockedUserIds([boardC], [teacher, student]);

				expect(result.size).toBe(0);
			});

			it('should need the boards of every learning path a student goes', async () => {
				const { boardA, boardB, boardC, blue, green, teacher, student, enroll, complete } = setup();
				enroll(student, blue, green);
				complete(student, boardA);

				expect((await service.lockedUserIds([boardC], [teacher, student])).get(boardC.id)).toEqual([student.userId]);

				complete(student, boardA, boardB);

				expect((await service.lockedUserIds([boardC], [teacher, student])).size).toBe(0);
			});

			it('should keep the board closed while no learning path is chosen', async () => {
				const { boardA, boardC, teacher, student } = setup();

				const result = await service.lockedUserIds([boardC], [teacher, student]);

				expect(result.get(boardC.id)).toEqual([student.userId]);
				// boards at the start of a path stay open
				expect((await service.lockedUserIds([boardA], [teacher, student])).size).toBe(0);
			});

			it('should never lock editors', async () => {
				const { boardC, teacher } = setup();

				const result = await service.lockedUserIds([boardC], [teacher]);

				expect(result.size).toBe(0);
			});

			it('should skip all work when no step locks the board', async () => {
				const board = columnBoardFactory.build({
					context: { type: BoardExternalReferenceType.Room, id: new ObjectId().toHexString() },
				});
				boardNodeRepo.findLearningPathStepsLinking.mockResolvedValueOnce([
					learningPathStepFactory.build({ linkedBoardId: board.id }),
				]);

				const result = await service.lockedUserIds([board], [{ userId: 'u', roles: [BoardRoles.READER] }]);

				expect(result.size).toBe(0);
				expect(boardNodeService.findByIds).not.toHaveBeenCalled();
			});
		});

		describe('findLocks', () => {
			it('should name the learning path that keeps the board closed', async () => {
				const { boardC, blue, student, enroll } = setup();
				enroll(student, blue);

				const result = await service.findLocks([boardC], student);

				expect(result.get(boardC.id)).toEqual({ pathId: blue.id, pathTitle: 'Blue', reason: 'prerequisites' });
			});

			it('should ask to choose a learning path when none is chosen', async () => {
				const { boardC, student } = setup();

				const result = await service.findLocks([boardC], student);

				expect(result.get(boardC.id)?.reason).toBe('chooseLearningPath');
			});
		});

		describe('summarize', () => {
			it('should show a student what the learning paths they go keep closed, in every path', async () => {
				const { boardC, blue, green, student, enroll } = setup();
				enroll(student, blue);

				const result = await service.summarize([{ board: green, users: [student], isEditor: false }], student.userId);

				const steps = result.get(green.id)?.steps ?? [];
				expect(result.get(green.id)?.isEnrolled).toBe(false);
				expect(steps.find((entry) => entry.step.linkedBoardId === boardC.id)).toMatchObject({
					status: 'locked',
					lock: { pathId: blue.id },
				});
				// green is not gone, so its own prerequisite does not matter
				expect(steps.find((entry) => entry.title === 'B')?.status).toBe('open');
			});

			it('should count the students who go a learning path for editors', async () => {
				const { boardA, boardC, blue, teacher, student, enroll, complete } = setup();
				const other: UserWithBoardRoles = { userId: new ObjectId().toHexString(), roles: [BoardRoles.READER] };
				enroll(student, blue);
				complete(student, boardA, boardC);

				const result = await service.summarize(
					[{ board: blue, users: [teacher, student, other], isEditor: true }],
					teacher.userId
				);

				expect(result.get(blue.id)).toMatchObject({ studentCount: 1, completedStudentCount: 1 });
				expect(result.get(blue.id)?.steps[0]).toMatchObject({ doneCount: 1, studentCount: 1 });
			});
		});

		describe('overview', () => {
			it('should list who goes which learning path with their progress', async () => {
				const { boardA, blue, green, teacher, student, enroll, complete } = setup();
				enroll(student, blue);
				complete(student, boardA);

				const result = await service.overview(blue.context.id, [teacher, student]);

				expect(result.paths.map((path) => path.title)).toEqual(['Blue', 'Green']);
				expect(result.students).toHaveLength(1);
				expect(result.students[0].paths).toEqual([
					{ pathId: blue.id, done: 1, total: 2, rework: 0, nextBoardTitle: 'C' },
				]);
				expect(green.id).toBeDefined();
			});
		});
	});
});
