import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { LegacyLogger } from '@infra/logger';
import { AuthorizationService } from '@modules/authorization';
import { BoardContextApiHelperService } from '@modules/board-context';
import { CourseService } from '@modules/course';
import { CourseEntity, CourseGroupEntity } from '@modules/course/repo';
import { RoomService } from '@modules/room';
import { RoomMembershipService } from '@modules/room-membership';
import { User } from '@modules/user/repo';
import { userFactory } from '@modules/user/testing';
import { Test, type TestingModule } from '@nestjs/testing';
import { setupEntities } from '@testing/database';
import { CopyElementType, type CopyStatus, CopyStatusEnum } from '../../copy-helper';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import { type BoardNodeAuthorizable, BoardExternalReferenceType, BoardNodeFactory } from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService, ColumnBoardService, LearningRoomService } from '../service';
import {
	boardNodeAuthorizableFactory,
	cardFactory,
	columnBoardFactory,
	columnFactory,
	pinnedCardFactory,
} from '../testing';
import { BoardUc } from './board.uc';

describe(BoardUc.name, () => {
	let module: TestingModule;
	let uc: BoardUc;
	let boardNodeService: DeepMocked<BoardNodeService>;
	let columnBoardService: DeepMocked<ColumnBoardService>;
	let boardNodeRule: DeepMocked<BoardNodeRule>;
	let boardNodeAuthorizableService: DeepMocked<BoardNodeAuthorizableService>;
	let authorizationService: DeepMocked<AuthorizationService>;
	let learningRoomService: DeepMocked<LearningRoomService>;
	let boardContextApiHelperService: DeepMocked<BoardContextApiHelperService>;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				BoardUc,
				{
					provide: AuthorizationService,
					useValue: createMock<AuthorizationService>(),
				},
				{
					provide: BoardNodeService,
					useValue: createMock<BoardNodeService>(),
				},
				{
					provide: ColumnBoardService,
					useValue: createMock<ColumnBoardService>(),
				},
				{
					provide: CourseService,
					useValue: createMock<CourseService>(),
				},
				{
					provide: RoomService,
					useValue: createMock<RoomService>(),
				},
				{
					provide: BoardNodeFactory,
					useValue: createMock<BoardNodeFactory>(),
				},
				{
					provide: RoomMembershipService,
					useValue: createMock<RoomMembershipService>(),
				},
				{
					provide: BoardContextApiHelperService,
					useValue: createMock<BoardContextApiHelperService>(),
				},
				{
					provide: BoardNodeAuthorizableService,
					useValue: createMock<BoardNodeAuthorizableService>(),
				},
				{
					provide: LegacyLogger,
					useValue: createMock<LegacyLogger>(),
				},
				{
					provide: BOARD_CONFIG_TOKEN,
					useValue: {},
				},
				{
					provide: BoardConfig,
					useValue: createMock<BoardConfig>(),
				},
				{
					provide: BoardNodeRule,
					useValue: createMock<BoardNodeRule>(),
				},
				{
					provide: LearningRoomService,
					useValue: createMock<LearningRoomService>(),
				},
			],
		}).compile();

		uc = module.get(BoardUc);
		boardNodeService = module.get(BoardNodeService);
		columnBoardService = module.get(ColumnBoardService);
		boardNodeRule = module.get(BoardNodeRule);
		authorizationService = module.get(AuthorizationService);
		learningRoomService = module.get(LearningRoomService);
		boardContextApiHelperService = module.get(BoardContextApiHelperService);
		boardNodeAuthorizableService = module.get(BoardNodeAuthorizableService);
		await setupEntities([User, CourseEntity, CourseGroupEntity]);
	});

	afterAll(async () => {
		await module.close();
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	const setup = () => {
		jest.clearAllMocks();
		const user = userFactory.buildWithId();
		const board = columnBoardFactory.build();
		const boardId = board.id;
		const column = columnFactory.build();

		return { user, board, boardId, column };
	};

	describe('findBoard', () => {
		// A personal board is loaded through this path as well - the collaboration
		// socket uses it - so the learning room specifics have to live here.
		const setupPersonalBoard = () => {
			const user = userFactory.build();
			const board = columnBoardFactory.build({
				context: { type: BoardExternalReferenceType.User, id: user.id },
			});
			const column = columnFactory.build();
			board.addChild(column);

			const readableCard = cardFactory.build();
			const lostCard = cardFactory.build();
			const readablePin = pinnedCardFactory.build({ referencedCardId: readableCard.id });
			const lostPin = pinnedCardFactory.build({ referencedCardId: lostCard.id });
			column.addChild(readablePin);
			column.addChild(lostPin);

			boardNodeService.findByClassAndId.mockResolvedValue(board as never);
			boardNodeService.findByClassAndIds.mockResolvedValue([readableCard, lostCard] as never);
			authorizationService.getUserWithPermissions.mockResolvedValue(user);
			boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue({} as BoardNodeAuthorizable);
			boardNodeAuthorizableService.getBoardAuthorizables.mockResolvedValue([
				{ boardNode: readableCard } as BoardNodeAuthorizable,
				{ boardNode: lostCard } as BoardNodeAuthorizable,
			]);
			boardContextApiHelperService.getFeaturesForBoardNode.mockResolvedValue([]);
			learningRoomService.findPinnedCards.mockReturnValue([readablePin, lostPin]);
			boardNodeRule.listAllowedOperations.mockReturnValue({
				deleteBoard: true,
				shareBoard: true,
				updateBoardTitle: true,
				createCard: true,
			} as unknown as Record<string, boolean> as never);
			boardNodeRule.can.mockImplementation((operation, _user, authorizable) => {
				if (operation === 'findBoard') return true;
				return authorizable.boardNode?.id === readableCard.id;
			});

			return { board, readablePin, lostPin };
		};

		it('should hide board actions that make no sense in a personal room', async () => {
			const { board } = setupPersonalBoard();

			const { allowedOperations } = await uc.findBoard('userId', board.id);

			// deleting the board would take every pinned card with it
			expect(allowedOperations.deleteBoard).toBe(false);
			expect(allowedOperations.shareBoard).toBe(false);
			expect(allowedOperations.updateBoardTitle).toBe(false);
			expect(allowedOperations.createCard).toBe(true);
		});

		it('should drop pointers whose card the user can no longer reach', async () => {
			const { board, lostPin } = setupPersonalBoard();

			await uc.findBoard('userId', board.id);

			expect(boardNodeService.delete).toHaveBeenCalledWith(lostPin);
			expect(boardNodeService.delete).toHaveBeenCalledTimes(1);
		});

		it('should map each remaining pointer to the name of its source room', async () => {
			const { board, readablePin } = setupPersonalBoard();
			boardContextApiHelperService.getParentsOfElement.mockResolvedValue([
				{ id: 'roomId', name: 'Mathe 9b', type: BoardExternalReferenceType.Room },
			] as never);

			const { pinnedCardOrigins } = await uc.findBoard('userId', board.id);

			expect(pinnedCardOrigins.get(readablePin.id)).toBe('Mathe 9b');
		});

		it('should leave a course board untouched', async () => {
			const user = userFactory.build();
			const board = columnBoardFactory.build({
				context: { type: BoardExternalReferenceType.Course, id: 'courseId' },
			});

			boardNodeService.findByClassAndId.mockResolvedValue(board as never);
			authorizationService.getUserWithPermissions.mockResolvedValue(user);
			boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue({} as BoardNodeAuthorizable);
			boardContextApiHelperService.getFeaturesForBoardNode.mockResolvedValue([]);
			boardNodeRule.can.mockReturnValue(true);
			boardNodeRule.listAllowedOperations.mockReturnValue({
				deleteBoard: true,
				shareBoard: true,
			} as unknown as Record<string, boolean> as never);

			const { allowedOperations, pinnedCardOrigins } = await uc.findBoard('userId', board.id);

			expect(allowedOperations.deleteBoard).toBe(true);
			expect(allowedOperations.shareBoard).toBe(true);
			expect(pinnedCardOrigins.size).toBe(0);
			expect(boardNodeService.delete).not.toHaveBeenCalled();
		});
	});

	describe('copyColumnBoard', () => {
		describe('when something goes wrong', () => {
			it('should throw InternalServerError if copyEntity is not a Column', async () => {
				const { user, board } = setup();
				const column = columnFactory.build({ path: board.id });
				boardNodeService.findByClassAndId.mockResolvedValueOnce(column);

				boardNodeRule.can.mockReturnValueOnce(true);

				const boardAuthorizable = boardNodeAuthorizableFactory.build({ boardNode: column });

				authorizationService.getUserWithPermissions.mockResolvedValueOnce(user);
				boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValueOnce(boardAuthorizable);

				const copyStatus: CopyStatus = {
					status: CopyStatusEnum.SUCCESS,
					type: CopyElementType.COLUMN,
					elements: [],
					copyEntity: board, // Intentionally incorrect type to trigger the error
				};
				columnBoardService.copyColumn.mockResolvedValueOnce(copyStatus);

				await expect(uc.copyColumn(user.id, column.id, 'school-id')).rejects.toThrow('Copied entity is not a column');
			});
		});
	});

	describe('copyColumn', () => {
		describe('when copy succeeds', () => {
			it('should call swapLinkedIdsInCopy with the copy status', async () => {
				const { user, board } = setup();
				const column = columnFactory.build({ path: board.id });
				const copiedColumn = columnFactory.build();

				boardNodeService.findByClassAndId.mockResolvedValueOnce(column);
				boardNodeRule.can.mockReturnValueOnce(true);
				authorizationService.getUserWithPermissions.mockResolvedValueOnce(user);
				boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValueOnce(
					boardNodeAuthorizableFactory.build({ boardNode: column })
				);

				const copyStatus: CopyStatus = {
					status: CopyStatusEnum.SUCCESS,
					type: CopyElementType.COLUMN,
					elements: [],
					copyEntity: copiedColumn,
				};
				columnBoardService.copyColumn.mockResolvedValueOnce(copyStatus);
				columnBoardService.updateIdsInLinks.mockResolvedValueOnce(copyStatus);

				await uc.copyColumn(user.id, column.id, 'school-id');

				expect(columnBoardService.updateIdsInLinks).toHaveBeenCalledWith(copyStatus);
			});
		});
	});
});
