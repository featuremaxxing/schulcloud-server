import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { RoomArrangementRepo } from '../../repo';
import { type RoomArrangement } from '../type';
import { RoomArrangementService } from './room-arrangement.service';

describe('RoomArrangementService', () => {
	let module: TestingModule;
	let service: RoomArrangementService;
	let repo: DeepMocked<RoomArrangementRepo>;

	const mathe = { id: 'tag-mathe', name: 'Mathe' };
	const physik = { id: 'tag-physik', name: 'Physik' };

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

	const givenArrangement = (arrangement: RoomArrangement) => {
		repo.hasArrangementForUserId.mockResolvedValue(true);
		repo.findArrangementByUserId.mockResolvedValue(arrangement);
	};

	const storedArrangement = () => {
		const [, items, tags] = repo.updateArrangement.mock.calls[0];
		return { items, tags };
	};

	describe('getArrangement', () => {
		describe('when the user has no arrangement yet', () => {
			it('should create one in the given order without tags', async () => {
				repo.hasArrangementForUserId.mockResolvedValueOnce(false);

				const result = await service.getArrangement('user', ['a', 'b']);

				expect(repo.createArrangement).toHaveBeenCalledWith('user', [{ id: 'a' }, { id: 'b' }]);
				expect(result).toEqual({ items: [{ id: 'a' }, { id: 'b' }], tags: [] });
			});
		});

		describe('when the user has an arrangement with tags', () => {
			it('should keep order and tags of available rooms and append new rooms', async () => {
				givenArrangement({ items: [{ id: 'b', tagIds: [mathe.id] }, { id: 'a' }], tags: [mathe] });

				const result = await service.getArrangement('user', ['a', 'b', 'new']);

				expect(result).toEqual({ items: [{ id: 'b', tagIds: [mathe.id] }, { id: 'a' }, { id: 'new' }], tags: [mathe] });
			});

			it('should drop tags whose rooms are gone and references to unknown tags', async () => {
				givenArrangement({
					items: [
						{ id: 'a', tagIds: ['missing'] },
						{ id: 'gone', tagIds: [physik.id] },
					],
					tags: [mathe, physik],
				});

				const result = await service.getArrangement('user', ['a']);

				expect(result).toEqual({ items: [{ id: 'a' }], tags: [] });
				expect(repo.updateArrangement).toHaveBeenCalledWith('user', result.items, result.tags);
			});
		});
	});

	describe('sortRoomIdsByUserArrangement', () => {
		it('should return the room ids in arranged order', async () => {
			givenArrangement({ items: [{ id: 'b' }, { id: 'a' }], tags: [] });

			const result = await service.sortRoomIdsByUserArrangement('user', ['a', 'b']);

			expect(result).toEqual(['b', 'a']);
		});
	});

	describe('setRoomTags', () => {
		it('should reuse existing tags regardless of case and create new ones', async () => {
			givenArrangement({ items: [{ id: 'a' }, { id: 'b', tagIds: [mathe.id] }], tags: [mathe] });

			const result = await service.setRoomTags('user', 'a', ['mathe', '  Klasse   7a ']);

			const klasse = result.tags.find((tag) => tag.name === 'Klasse 7a');
			expect(klasse?.id).toEqual(expect.any(String));
			expect(result.items[0]).toEqual({ id: 'a', tagIds: [mathe.id, klasse?.id] });
			expect(storedArrangement()).toEqual(result);
		});

		it('should ignore empty and duplicate names', async () => {
			givenArrangement({ items: [{ id: 'a' }], tags: [mathe] });

			const result = await service.setRoomTags('user', 'a', ['', '  ', 'Mathe', 'MATHE']);

			expect(result).toEqual({ items: [{ id: 'a', tagIds: [mathe.id] }], tags: [mathe] });
		});

		it('should remove tags no room uses anymore', async () => {
			givenArrangement({
				items: [
					{ id: 'a', tagIds: [mathe.id, physik.id] },
					{ id: 'b', tagIds: [mathe.id] },
				],
				tags: [mathe, physik],
			});

			const result = await service.setRoomTags('user', 'a', []);

			expect(result).toEqual({ items: [{ id: 'a' }, { id: 'b', tagIds: [mathe.id] }], tags: [mathe] });
		});

		it('should throw when the room is not in the arrangement', async () => {
			givenArrangement({ items: [{ id: 'a' }], tags: [] });

			await expect(service.setRoomTags('user', 'other', ['Mathe'])).rejects.toThrow(BadRequestException);
		});
	});

	describe('renameTag', () => {
		it('should rename the tag', async () => {
			givenArrangement({ items: [{ id: 'a', tagIds: [mathe.id] }], tags: [mathe] });

			await service.renameTag('user', mathe.id, '  Mathematik ');

			expect(storedArrangement()).toEqual({
				items: [{ id: 'a', tagIds: [mathe.id] }],
				tags: [{ id: mathe.id, name: 'Mathematik' }],
			});
		});

		it('should merge into a tag that already has the new name', async () => {
			givenArrangement({
				items: [
					{ id: 'a', tagIds: [mathe.id] },
					{ id: 'b', tagIds: [physik.id, mathe.id] },
				],
				tags: [mathe, physik],
			});

			await service.renameTag('user', physik.id, 'mathe');

			expect(storedArrangement()).toEqual({
				items: [
					{ id: 'a', tagIds: [mathe.id] },
					{ id: 'b', tagIds: [mathe.id] },
				],
				tags: [mathe],
			});
		});

		it('should throw for an unknown tag', async () => {
			givenArrangement({ items: [], tags: [] });

			await expect(service.renameTag('user', 'missing', 'Mathe')).rejects.toThrow(NotFoundException);
		});

		it('should throw for an empty name', async () => {
			givenArrangement({ items: [{ id: 'a', tagIds: [mathe.id] }], tags: [mathe] });

			await expect(service.renameTag('user', mathe.id, '   ')).rejects.toThrow(BadRequestException);
		});
	});

	describe('deleteTag', () => {
		it('should remove the tag from all rooms and keep the rooms', async () => {
			givenArrangement({
				items: [
					{ id: 'a', tagIds: [mathe.id, physik.id] },
					{ id: 'b', tagIds: [mathe.id] },
				],
				tags: [mathe, physik],
			});

			await service.deleteTag('user', mathe.id);

			expect(storedArrangement()).toEqual({ items: [{ id: 'a', tagIds: [physik.id] }, { id: 'b' }], tags: [physik] });
		});

		it('should throw for an unknown tag', async () => {
			givenArrangement({ items: [], tags: [] });

			await expect(service.deleteTag('user', 'missing')).rejects.toThrow(NotFoundException);
		});
	});

	describe('moveRoom', () => {
		it('should keep the tags of the moved rooms', async () => {
			repo.findItemsByUserId.mockResolvedValueOnce([{ id: 'a', tagIds: [mathe.id] }, { id: 'b' }]);

			await service.moveRoom('user', 'a', 1);

			expect(repo.updateArrangement).toHaveBeenCalledWith('user', [{ id: 'b' }, { id: 'a', tagIds: [mathe.id] }]);
		});
	});
});
