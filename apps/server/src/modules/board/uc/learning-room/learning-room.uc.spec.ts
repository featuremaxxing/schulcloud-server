import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { AuthorizationService } from '@modules/authorization';
import { BoardNodeRule } from '@modules/board/authorisation/board-node.rule';
import { User } from '@modules/user/repo';
import { userFactory } from '@modules/user/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FeatureDisabledLoggableException } from '@shared/common/loggable-exception';
import { setupEntities } from '@testing/database';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../../board.config';
import { BoardExternalReferenceType, BoardNodeFactory, Card, type BoardNodeAuthorizable } from '../../domain';
import { BoardNodeAuthorizableService, BoardNodeService, LearningRoomService } from '../../service';
import { cardFactory, columnBoardFactory, columnFactory, pinnedCardFactory } from '../../testing';
import { BoardUc } from '../board.uc';
import { LearningRoomUc } from './learning-room.uc';

describe(LearningRoomUc.name, () => {
	let module: TestingModule;
	let uc: LearningRoomUc;

	let authorizationService: DeepMocked<AuthorizationService>;
	let boardNodeAuthorizableService: DeepMocked<BoardNodeAuthorizableService>;
	let boardNodeRule: DeepMocked<BoardNodeRule>;
	let boardNodeService: DeepMocked<BoardNodeService>;
	let boardNodeFactory: DeepMocked<BoardNodeFactory>;
	let learningRoomService: DeepMocked<LearningRoomService>;
	let boardUc: DeepMocked<BoardUc>;
	let config: BoardConfig;

	beforeAll(async () => {
		await setupEntities([User]);

		module = await Test.createTestingModule({
			providers: [
				LearningRoomUc,
				{ provide: AuthorizationService, useValue: createMock<AuthorizationService>() },
				{ provide: BoardNodeAuthorizableService, useValue: createMock<BoardNodeAuthorizableService>() },
				{ provide: BoardNodeRule, useValue: createMock<BoardNodeRule>() },
				{ provide: BoardNodeService, useValue: createMock<BoardNodeService>() },
				{ provide: BoardNodeFactory, useValue: createMock<BoardNodeFactory>() },
				{ provide: LearningRoomService, useValue: createMock<LearningRoomService>() },
				{ provide: BoardUc, useValue: createMock<BoardUc>() },
				{ provide: BOARD_CONFIG_TOKEN, useValue: new BoardConfig() },
			],
		}).compile();

		uc = module.get(LearningRoomUc);
		authorizationService = module.get(AuthorizationService);
		boardNodeAuthorizableService = module.get(BoardNodeAuthorizableService);
		boardNodeRule = module.get(BoardNodeRule);
		boardNodeService = module.get(BoardNodeService);
		boardNodeFactory = module.get(BoardNodeFactory);
		learningRoomService = module.get(LearningRoomService);
		boardUc = module.get(BoardUc);
		config = module.get(BOARD_CONFIG_TOKEN);
	});

	afterAll(async () => {
		await module.close();
	});

	beforeEach(() => {
		config.featurePersonalLearningRoomEnabled = true;
	});

	afterEach(() => {
		jest.resetAllMocks();
	});

	describe('when the feature is disabled', () => {
		it('should refuse every operation', async () => {
			config.featurePersonalLearningRoomEnabled = false;

			await expect(uc.getLearningRoom('userId')).rejects.toThrow(FeatureDisabledLoggableException);
			await expect(uc.pinCard('userId', 'cardId')).rejects.toThrow(FeatureDisabledLoggableException);
			await expect(uc.unpinCard('userId', 'cardId')).rejects.toThrow(FeatureDisabledLoggableException);
			await expect(uc.getPinnedCardIds('userId')).rejects.toThrow(FeatureDisabledLoggableException);
		});
	});

	describe('pinCard', () => {
		const setup = () => {
			const user = userFactory.build();
			const card = cardFactory.build();
			const column = columnFactory.build();
			const board = columnBoardFactory.build();
			board.addChild(column);

			authorizationService.getUserWithPermissions.mockResolvedValue(user);
			boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue({} as BoardNodeAuthorizable);
			boardNodeService.findByClassAndId.mockResolvedValue(card as never);
			learningRoomService.getOrCreatePersonalLearningRoomOfUser.mockResolvedValue(board);

			return { card, column, board };
		};

		describe('when the user may not see the card in its original board', () => {
			it('should refuse to pin it', async () => {
				const { card } = setup();
				boardNodeRule.can.mockReturnValue(false);

				await expect(uc.pinCard('userId', card.id)).rejects.toThrow(ForbiddenException);
				expect(boardNodeService.addToParent).not.toHaveBeenCalled();
			});
		});

		describe('when the user may see the card', () => {
			it('should add a pointer to the first column', async () => {
				const { card, column } = setup();
				boardNodeRule.can.mockReturnValue(true);
				learningRoomService.findPinnedCardByReference.mockReturnValue(undefined);
				const pinnedCard = pinnedCardFactory.build({ referencedCardId: card.id });
				boardNodeFactory.buildPinnedCard.mockReturnValue(pinnedCard);

				await uc.pinCard('userId', card.id);

				expect(boardNodeFactory.buildPinnedCard).toHaveBeenCalledWith(card.id);
				expect(boardNodeService.addToParent).toHaveBeenCalledWith(column, pinnedCard);
			});

			it('should not pin the same card twice', async () => {
				const { card } = setup();
				boardNodeRule.can.mockReturnValue(true);
				const existing = pinnedCardFactory.build({ referencedCardId: card.id });
				learningRoomService.findPinnedCardByReference.mockReturnValue(existing);

				const result = await uc.pinCard('userId', card.id);

				expect(result).toBe(existing);
				expect(boardNodeService.addToParent).not.toHaveBeenCalled();
			});

			it('should authorize the card, never the learning room', async () => {
				const { card } = setup();
				boardNodeRule.can.mockReturnValue(true);
				learningRoomService.findPinnedCardByReference.mockReturnValue(undefined);
				boardNodeFactory.buildPinnedCard.mockReturnValue(pinnedCardFactory.build());

				await uc.pinCard('userId', card.id);

				expect(boardNodeService.findByClassAndId).toHaveBeenCalledWith(Card, card.id);
				expect(boardNodeRule.can).toHaveBeenCalledWith('findCards', expect.anything(), expect.anything());
			});
		});
	});

	describe('getLearningRoom', () => {
		// the personal board handling itself lives in BoardUc.findBoard, because the
		// collaboration socket loads boards through that path as well
		it('should create the board and hand it to the shared board path', async () => {
			const board = columnBoardFactory.build();
			learningRoomService.getOrCreatePersonalLearningRoomOfUser.mockResolvedValue(board);
			const expected = {
				board,
				features: [],
				allowedOperations: {} as never,
				pinnedCardOrigins: new Map<string, string>(),
			};
			boardUc.findBoard.mockResolvedValue(expected);

			const result = await uc.getLearningRoom('userId');

			expect(boardUc.findBoard).toHaveBeenCalledWith('userId', board.id);
			expect(result).toBe(expected);
		});
	});

	describe('movePinnedCard', () => {
		const setup = () => {
			const board = columnBoardFactory.build();
			const column = columnFactory.build();
			board.addChild(column);
			const pinnedCard = pinnedCardFactory.build();
			column.addChild(pinnedCard);

			learningRoomService.getOrCreatePersonalLearningRoomOfUser.mockResolvedValue(board);
			learningRoomService.findPinnedCards.mockReturnValue([pinnedCard]);

			return { board, column, pinnedCard };
		};

		it('should move the pointer inside the learning room', async () => {
			const { column, pinnedCard } = setup();

			await uc.movePinnedCard('userId', pinnedCard.id, column.id, 0);

			expect(boardNodeService.move).toHaveBeenCalledWith(pinnedCard, column, 0);
		});

		it('should reject a pointer that is not in this learning room', async () => {
			const { column } = setup();
			learningRoomService.findPinnedCards.mockReturnValue([]);

			await expect(uc.movePinnedCard('userId', 'foreignPinId', column.id, 0)).rejects.toThrow(BadRequestException);
			expect(boardNodeService.move).not.toHaveBeenCalled();
		});

		it('should reject a target column outside this learning room', async () => {
			const { pinnedCard } = setup();

			await expect(uc.movePinnedCard('userId', pinnedCard.id, 'foreignColumnId', 0)).rejects.toThrow(
				BadRequestException
			);
			expect(boardNodeService.move).not.toHaveBeenCalled();
		});
	});
});
