import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { Test, type TestingModule } from '@nestjs/testing';
import { BOARD_CONFIG_TOKEN } from '../board.config';
import { BoardLayout, BoardRoles, type ColumnBoard, type UserWithBoardRoles } from '../domain';
import { BoardCompletionEntity, BoardCompletionRepo, BoardNodeRepo } from '../repo';
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

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				LearningPathStateService,
				{ provide: BoardNodeRepo, useValue: createMock<BoardNodeRepo>() },
				{ provide: BoardNodeService, useValue: createMock<BoardNodeService>() },
				{ provide: BoardProgressService, useValue: createMock<BoardProgressService>() },
				{ provide: BoardCompletionRepo, useValue: createMock<BoardCompletionRepo>() },
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

	describe('computeStates', () => {
		it('should lock a step until all prerequisites are done', () => {
			const { a, b, c, boardA, linkedBoards, userId } = buildPath('all');
			const completed = new Map([[boardA.id, new Set([userId])]]);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states.map((state) => state.status)).toEqual(['done', 'open', 'locked']);
		});

		it('should open a step when one prerequisite is enough', () => {
			const { a, b, c, boardA, linkedBoards, userId } = buildPath('any');
			const completed = new Map([[boardA.id, new Set([userId])]]);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states[2].status).toBe('open');
		});

		it('should not block on a prerequisite whose board is still a draft', () => {
			const { a, b, c, boardA, boardB, linkedBoards, userId } = buildPath('all');
			boardB.isVisible = false;
			const completed = new Map([[boardA.id, new Set([userId])]]);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states.map((state) => state.status)).toEqual(['done', 'unavailable', 'open']);
		});

		it('should not block on a prerequisite whose board is gone', () => {
			const { a, b, c, boardA, boardB, linkedBoards, userId } = buildPath('all');
			linkedBoards.delete(boardB.id);
			const completed = new Map([[boardA.id, new Set([userId])]]);

			const states = service.computeStates([a, b, c], linkedBoards, completed, userId);

			expect(states[2].status).toBe('open');
		});

		it('should leave a step open when locking is off', () => {
			const { a, b, c, linkedBoards, userId } = buildPath('all');
			c.lockUntilPrerequisitesDone = false;

			const states = service.computeStates([a, b, c], linkedBoards, new Map(), userId);

			expect(states[2].status).toBe('open');
		});
	});

	describe('completedUserIds', () => {
		it('should merge progress and stored completions', async () => {
			const { boardA, boardB, userId } = buildPath('all');
			const otherId = new ObjectId().toHexString();
			boardProgressService.computeCompletedUserIds.mockResolvedValueOnce(
				new Map([
					[boardA.id, new Set([userId])],
					[boardB.id, new Set<string>()],
				])
			);
			boardCompletionRepo.findByBoardIds.mockResolvedValueOnce([
				new BoardCompletionEntity({ userId: otherId, boardId: boardB.id, completedAt: new Date(), source: 'manual' }),
			]);

			const result = await service.completedUserIds([boardA, boardB], []);

			expect(result.get(boardA.id)).toEqual(new Set([userId]));
			expect(result.get(boardB.id)).toEqual(new Set([otherId]));
		});
	});

	describe('lockedUserIds', () => {
		const setup = () => {
			const { a, b, c, boardA, boardB, boardC, userId, pathId } = buildPath('all');
			const pathBoard = columnBoardFactory.build({
				id: pathId,
				layout: BoardLayout.LEARNING_PATH,
				isVisible: true,
				children: [a, b, c],
			});
			const teacher: UserWithBoardRoles = { userId: new ObjectId().toHexString(), roles: [BoardRoles.EDITOR] };
			const student: UserWithBoardRoles = { userId, roles: [BoardRoles.READER] };

			boardNodeRepo.findLearningPathStepsLinking.mockResolvedValueOnce([c]);
			boardNodeService.findByIds.mockImplementation((ids: string[]) =>
				Promise.resolve([pathBoard, boardA, boardB, boardC].filter((board) => ids.includes(board.id)))
			);
			boardCompletionRepo.findByBoardIds.mockResolvedValue([]);

			return { boardC, pathBoard, teacher, student };
		};

		it('should lock the board for students who did not complete the prerequisites', async () => {
			const { boardC, teacher, student } = setup();
			boardProgressService.computeCompletedUserIds.mockResolvedValueOnce(new Map());

			const result = await service.lockedUserIds([boardC], [teacher, student]);

			expect(result.get(boardC.id)).toEqual([student.userId]);
		});

		it('should not lock anything while the learning path is a draft', async () => {
			const { boardC, pathBoard, teacher, student } = setup();
			pathBoard.isVisible = false;

			const result = await service.lockedUserIds([boardC], [teacher, student]);

			expect(result.size).toBe(0);
		});

		it('should skip all work when no step locks the board', async () => {
			const board = columnBoardFactory.build();
			boardNodeRepo.findLearningPathStepsLinking.mockResolvedValueOnce([
				learningPathStepFactory.build({ linkedBoardId: board.id }),
			]);

			const result = await service.lockedUserIds([board], []);

			expect(result.size).toBe(0);
			expect(boardNodeService.findByIds).not.toHaveBeenCalled();
		});
	});
});
