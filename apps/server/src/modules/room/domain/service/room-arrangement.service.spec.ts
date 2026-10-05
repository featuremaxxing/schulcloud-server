import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RoomArrangementRepo } from '../../repo';
import { RoomArrangementService } from './room-arrangement.service';

describe('RoomArrangementService', () => {
	let module: TestingModule;
	let service: RoomArrangementService;
	let repo: DeepMocked<RoomArrangementRepo>;

	const mathe = { id: '0b6f1f7e-3d1c-4a63-9a43-6f7c2f1d9a10', title: 'Mathe' };
	const empty = { id: '7d1a5c2e-8b9f-4e3a-b1c2-d3e4f5a6b7c8', title: 'Leer' };

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				RoomArrangementService,
				{ provide: RoomArrangementRepo, useValue: createMock<RoomArrangementRepo>() },
			],
		}).compile();

		service = module.get(RoomArrangementService);
		repo = module.get(RoomArrangementRepo);
	});

	afterAll(async () => {
		await module.close();
	});

	afterEach(() => {
		jest.resetAllMocks();
	});

	describe('getArrangement', () => {
		describe('when the user has no arrangement yet', () => {
			it('should create one in the given order without collections', async () => {
				repo.hasArrangementForUserId.mockResolvedValueOnce(false);

				const result = await service.getArrangement('user', ['a', 'b']);

				expect(repo.createArrangement).toHaveBeenCalledWith('user', [{ id: 'a' }, { id: 'b' }]);
				expect(result).toEqual({ items: [{ id: 'a' }, { id: 'b' }], collections: [] });
			});
		});

		describe('when the user has an arrangement with collections', () => {
			const setup = () => {
				repo.hasArrangementForUserId.mockResolvedValueOnce(true);
				repo.findArrangementByUserId.mockResolvedValueOnce({
					items: [
						{ id: 'c' },
						{ id: 'a', collectionId: mathe.id },
						{ id: 'b', collectionId: mathe.id },
						{ id: 'x', collectionId: empty.id },
					],
					collections: [mathe, empty],
				});
			};

			it('should keep order and collection membership of available rooms', async () => {
				setup();

				const result = await service.getArrangement('user', ['a', 'b', 'c', 'new']);

				expect(result.items).toEqual([
					{ id: 'c' },
					{ id: 'a', collectionId: mathe.id },
					{ id: 'b', collectionId: mathe.id },
					{ id: 'new' },
				]);
			});

			it('should drop collections whose rooms are gone', async () => {
				setup();

				const result = await service.getArrangement('user', ['a', 'b', 'c']);

				expect(result.collections).toEqual([mathe]);
				expect(repo.updateArrangement).toHaveBeenCalledWith('user', result.items, [mathe]);
			});
		});

		describe('when an item references a collection that does not exist', () => {
			it('should ungroup the room', async () => {
				repo.hasArrangementForUserId.mockResolvedValueOnce(true);
				repo.findArrangementByUserId.mockResolvedValueOnce({
					items: [{ id: 'a', collectionId: 'missing' }],
					collections: [],
				});

				const result = await service.getArrangement('user', ['a']);

				expect(result).toEqual({ items: [{ id: 'a' }], collections: [] });
			});
		});
	});

	describe('sortRoomIdsByUserArrangement', () => {
		it('should return the room ids in arranged order', async () => {
			repo.hasArrangementForUserId.mockResolvedValueOnce(true);
			repo.findArrangementByUserId.mockResolvedValueOnce({ items: [{ id: 'b' }, { id: 'a' }], collections: [] });

			const result = await service.sortRoomIdsByUserArrangement('user', ['a', 'b']);

			expect(result).toEqual(['b', 'a']);
		});
	});

	describe('arrangeRooms', () => {
		beforeEach(() => {
			repo.findItemsByUserId.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
		});

		it('should store the requested order and collections', async () => {
			await service.arrangeRooms(
				'user',
				[{ id: 'c' }, { id: 'a', collectionId: mathe.id }, { id: 'b', collectionId: mathe.id }],
				[mathe]
			);

			expect(repo.updateArrangement).toHaveBeenCalledWith(
				'user',
				[{ id: 'c' }, { id: 'a', collectionId: mathe.id }, { id: 'b', collectionId: mathe.id }],
				[mathe]
			);
		});

		it('should ignore unknown and duplicate rooms and append missing ones', async () => {
			await service.arrangeRooms(
				'user',
				[{ id: 'foreign' }, { id: 'b' }, { id: 'b', collectionId: mathe.id }],
				[mathe]
			);

			expect(repo.updateArrangement).toHaveBeenCalledWith('user', [{ id: 'b' }, { id: 'a' }, { id: 'c' }], []);
		});

		it('should drop references to unknown collections and unused or duplicate collections', async () => {
			await service.arrangeRooms(
				'user',
				[{ id: 'a', collectionId: 'missing' }, { id: 'b', collectionId: mathe.id }, { id: 'c' }],
				[mathe, { ...mathe, title: 'Doppelt' }, empty]
			);

			expect(repo.updateArrangement).toHaveBeenCalledWith(
				'user',
				[{ id: 'a' }, { id: 'b', collectionId: mathe.id }, { id: 'c' }],
				[mathe]
			);
		});
	});
});
