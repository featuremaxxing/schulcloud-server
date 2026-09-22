import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { AuthorizationService } from '@modules/authorization';
import { BoardContextApiHelperService } from '@modules/board-context';
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
	let boardContextApiHelperService: DeepMocked<BoardContextApiHelperService>;
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
				{ provide: BoardContextApiHelperService, useValue: createMock<BoardContextApiHelperService>() },
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
		boardContextApiHelperService = module.get(BoardContextApiHelperService);
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
		const setup = () => {
			const user = userFactory.build();
			const board = columnBoardFactory.build();
			const column = columnFactory.build();
			board.addChild(column);

			const readableCard = cardFactory.build();
			const lostCard = cardFactory.build();
			const readablePin = pinnedCardFactory.build({ referencedCardId: readableCard.id });
			const lostPin = pinnedCardFactory.build({ referencedCardId: lostCard.id });
			column.addChild(readablePin);
			column.addChild(lostPin);

			authorizationService.getUserWithPermissions.mockResolvedValue(user);
			boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue({} as BoardNodeAuthorizable);
			learningRoomService.getOrCreatePersonalLearningRoomOfUser.mockResolvedValue(board);
			learningRoomService.findPinnedCards.mockReturnValue([readablePin, lostPin]);
			boardNodeService.findByClassAndIds.mockResolvedValue([readableCard, lostCard] as never);
			boardNodeRule.listAllowedOperations.mockReturnValue({} as Record<ReturnType<typeof String>, boolean> as never);

			// only the readable card passes the rule
			boardNodeAuthorizableService.getBoardAuthorizables.mockResolvedValue([
				{ boardNode: readableCard } as BoardNodeAuthorizable,
				{ boardNode: lostCard } as BoardNodeAuthorizable,
			]);
			boardNodeRule.can.mockImplementation(
				(_operation, _user, authorizable) => authorizable.boardNode.id === readableCard.id
			);

			return { readableCard, lostCard, readablePin, lostPin };
		};

		it('should hide board actions that make no sense in a personal room', async () => {
			setup();
			boardNodeRule.listAllowedOperations.mockReturnValue({
				deleteBoard: true,
				copyBoard: true,
				shareBoard: true,
				updateBoardTitle: true,
				updateBoardVisibility: true,
				updateReadersCanEditSetting: true,
				createCard: true,
			} as unknown as Record<string, boolean> as never);

			const { allowedOperations } = await uc.getLearningRoom('userId');

			// deleting the board would take every pinned card with it
			expect(allowedOperations.deleteBoard).toBe(false);
			expect(allowedOperations.copyBoard).toBe(false);
			expect(allowedOperations.shareBoard).toBe(false);
			expect(allowedOperations.updateBoardTitle).toBe(false);
			expect(allowedOperations.updateBoardVisibility).toBe(false);
			expect(allowedOperations.updateReadersCanEditSetting).toBe(false);
			// working with the content stays untouched
			expect(allowedOperations.createCard).toBe(true);
		});

		it('should drop pointers whose card the user can no longer reach', async () => {
			const { lostPin } = setup();

			await uc.getLearningRoom('userId');

			expect(boardNodeService.delete).toHaveBeenCalledWith(lostPin);
			expect(boardNodeService.delete).toHaveBeenCalledTimes(1);
		});

		it('should map each remaining pointer to the name of its source room', async () => {
			const { readablePin } = setup();
			boardContextApiHelperService.getParentsOfElement.mockResolvedValue([
				{ id: 'roomId', name: 'Mathe 9b', type: BoardExternalReferenceType.Room },
			] as never);

			const { pinnedCardOrigins } = await uc.getLearningRoom('userId');

			expect(pinnedCardOrigins.get(readablePin.id)).toBe('Mathe 9b');
		});

		it('should resolve each source board only once', async () => {
			const user = userFactory.build();

			// two cards sitting in the same source board, so their rootId matches
			const sourceBoard = columnBoardFactory.build();
			const sourceColumn = columnFactory.build();
			sourceBoard.addChild(sourceColumn);
			const firstCard = cardFactory.build();
			const secondCard = cardFactory.build();
			sourceColumn.addChild(firstCard);
			sourceColumn.addChild(secondCard);

			const learningRoom = columnBoardFactory.build();
			const column = columnFactory.build();
			learningRoom.addChild(column);
			const firstPin = pinnedCardFactory.build({ referencedCardId: firstCard.id });
			const secondPin = pinnedCardFactory.build({ referencedCardId: secondCard.id });
			column.addChild(firstPin);
			column.addChild(secondPin);

			authorizationService.getUserWithPermissions.mockResolvedValue(user);
			boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue({} as BoardNodeAuthorizable);
			learningRoomService.getOrCreatePersonalLearningRoomOfUser.mockResolvedValue(learningRoom);
			learningRoomService.findPinnedCards.mockReturnValue([firstPin, secondPin]);
			boardNodeService.findByClassAndIds.mockResolvedValue([firstCard, secondCard] as never);
			boardNodeAuthorizableService.getBoardAuthorizables.mockResolvedValue([
				{ boardNode: firstCard } as BoardNodeAuthorizable,
				{ boardNode: secondCard } as BoardNodeAuthorizable,
			]);
			boardNodeRule.can.mockReturnValue(true);
			boardContextApiHelperService.getParentsOfElement.mockResolvedValue([
				{ id: 'roomId', name: 'Mathe 9b', type: BoardExternalReferenceType.Room },
			] as never);

			const { pinnedCardOrigins } = await uc.getLearningRoom('userId');

			expect(boardContextApiHelperService.getParentsOfElement).toHaveBeenCalledTimes(1);
			expect(pinnedCardOrigins.get(firstPin.id)).toBe('Mathe 9b');
			expect(pinnedCardOrigins.get(secondPin.id)).toBe('Mathe 9b');
		});

		it('should leave the chip empty when the source cannot be resolved', async () => {
			const { readablePin } = setup();
			boardContextApiHelperService.getParentsOfElement.mockRejectedValue(new Error('gone'));

			const { pinnedCardOrigins } = await uc.getLearningRoom('userId');

			expect(pinnedCardOrigins.get(readablePin.id)).toBeUndefined();
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
