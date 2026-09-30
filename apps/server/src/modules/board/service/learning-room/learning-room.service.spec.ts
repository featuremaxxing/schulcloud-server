import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BoardExternalReferenceType, BoardNodeFactory, ColumnBoard } from '../../domain';
import { BoardNodeRepo } from '../../repo';
import { columnBoardFactory, columnFactory, mediaBoardFactory, pinnedCardFactory } from '../../testing';
import { DEFAULT_BOARD_TITLE, DEFAULT_COLUMN_TITLES, LearningRoomService } from './learning-room.service';

describe(LearningRoomService.name, () => {
	let module: TestingModule;
	let service: LearningRoomService;

	let boardNodeRepo: DeepMocked<BoardNodeRepo>;
	let boardNodeFactory: DeepMocked<BoardNodeFactory>;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				LearningRoomService,
				{ provide: BoardNodeRepo, useValue: createMock<BoardNodeRepo>() },
				{ provide: BoardNodeFactory, useValue: createMock<BoardNodeFactory>() },
			],
		}).compile();

		service = module.get(LearningRoomService);
		boardNodeRepo = module.get(BoardNodeRepo);
		boardNodeFactory = module.get(BoardNodeFactory);
	});

	afterAll(async () => {
		await module.close();
	});

	afterEach(() => {
		jest.resetAllMocks();
	});

	describe('getOrCreatePersonalLearningRoomOfUser', () => {
		describe('when the user already has a learning room', () => {
			it('should return it without creating another one', async () => {
				const existing = columnBoardFactory.build();
				boardNodeRepo.findByExternalReference.mockResolvedValue([existing]);

				const result = await service.getOrCreatePersonalLearningRoomOfUser('userId');

				expect(result).toBe(existing);
				expect(boardNodeRepo.save).not.toHaveBeenCalled();
			});
		});

		describe('when the user only has a media shelf', () => {
			// the media shelf uses the very same user context, so filtering by board
			// type is what keeps the learning room from hijacking it
			it('should create a learning room instead of returning the media board', async () => {
				const mediaBoard = mediaBoardFactory.build();
				boardNodeRepo.findByExternalReference.mockResolvedValue([mediaBoard]);
				const created = columnBoardFactory.build();
				boardNodeFactory.buildColumnBoard.mockReturnValue(created);
				boardNodeFactory.buildColumn.mockImplementation(() => columnFactory.build());

				const result = await service.getOrCreatePersonalLearningRoomOfUser('userId');

				expect(result).not.toBe(mediaBoard);
				expect(result).toBeInstanceOf(ColumnBoard);
				expect(boardNodeRepo.save).toHaveBeenCalledWith(created);
			});
		});

		describe('when the user has no board at all', () => {
			const setup = () => {
				boardNodeRepo.findByExternalReference.mockResolvedValue([]);
				const created = columnBoardFactory.build();
				boardNodeFactory.buildColumnBoard.mockReturnValue(created);
				boardNodeFactory.buildColumn.mockImplementation(() => columnFactory.build());

				return { created };
			};

			it('should create a board in the user context', async () => {
				setup();

				await service.getOrCreatePersonalLearningRoomOfUser('userId');

				expect(boardNodeFactory.buildColumnBoard).toHaveBeenCalledWith(
					expect.objectContaining({
						context: { type: BoardExternalReferenceType.User, id: 'userId' },
					})
				);
			});

			it('should give the board a title', async () => {
				const { created } = setup();

				await service.getOrCreatePersonalLearningRoomOfUser('userId');

				expect(boardNodeFactory.buildColumnBoard).toHaveBeenCalledWith(
					expect.objectContaining({ title: DEFAULT_BOARD_TITLE })
				);
				expect(created.isVisible).toBe(true);
			});

			it('should create the default columns, so a card can be pinned before it is ever opened', async () => {
				const { created } = setup();

				const result = await service.getOrCreatePersonalLearningRoomOfUser('userId');

				expect(boardNodeFactory.buildColumn).toHaveBeenCalledTimes(DEFAULT_COLUMN_TITLES.length);
				expect(result.children).toHaveLength(DEFAULT_COLUMN_TITLES.length);
				expect(created.isVisible).toBe(true);
			});
		});
	});

	describe('findPinnedCardByReference', () => {
		it('should find the pointer for a referenced card', () => {
			const board = columnBoardFactory.build();
			const column = columnFactory.build();
			board.addChild(column);
			const pinnedCard = pinnedCardFactory.build({ referencedCardId: 'referencedCardId' });
			column.addChild(pinnedCard);

			const result = service.findPinnedCardByReference(board, 'referencedCardId');

			expect(result).toBe(pinnedCard);
		});

		it('should return undefined when the card is not pinned', () => {
			const board = columnBoardFactory.build();

			const result = service.findPinnedCardByReference(board, 'referencedCardId');

			expect(result).toBeUndefined();
		});
	});
});
