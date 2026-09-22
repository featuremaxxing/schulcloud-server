import { EntityManager } from '@mikro-orm/mongodb';
import { Test, type TestingModule } from '@nestjs/testing';
import { BaseEntityWithTimestamps } from '@shared/domain/entity';
import { cleanupCollections } from '@testing/cleanup-collections';
import { MongoMemoryDatabaseModule } from '@testing/database';
import { BoardExternalReferenceType, ColumnBoard } from '../domain';
import {
	assignmentElementFactory,
	assignmentSubmissionFactory,
	cardFactory,
	columnBoardFactory,
	columnFactory,
} from '../testing';
import { BoardNodeRepo } from './board-node.repo';
import { BoardNodeEntity } from './entity/board-node.entity';

describe('BoardNodeRepo', () => {
	let module: TestingModule;
	let repo: BoardNodeRepo;
	let em: EntityManager;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			imports: [MongoMemoryDatabaseModule.forRoot({ entities: [BaseEntityWithTimestamps, BoardNodeEntity] })],
			providers: [BoardNodeRepo],
		}).compile();
		repo = module.get(BoardNodeRepo);
		em = module.get(EntityManager);
	});

	afterAll(async () => {
		await module.close();
	});

	afterEach(async () => {
		await cleanupCollections(em);
	});

	describe('save', () => {
		const setup = () => {
			const board = columnBoardFactory.build({
				children: columnFactory.buildList(2, { children: cardFactory.buildList(2) }),
			});

			return { board };
		};

		it('should be able to persist a tree of nodes', async () => {
			const { board } = setup();

			await repo.save(board);
			em.clear();

			const nodeCount = await em.count(BoardNodeEntity);
			expect(nodeCount).toBe(5);
		});

		it('should be able to persist multiple root nodes', async () => {
			const { board: board1 } = setup();
			const { board: board2 } = setup();

			await repo.save([board1, board2]);
			em.clear();

			const nodeCount = await em.count(BoardNodeEntity);
			expect(nodeCount).toBe(10);
		});

		it('should persist embedded context', async () => {
			const { board } = setup();

			await repo.save(board);
			em.clear();

			const result = await em.findOneOrFail(BoardNodeEntity, board.id);
			expect(result.context).toBeDefined();
		});
	});

	describe('findById', () => {
		const setup = async () => {
			const card = cardFactory.build();

			const column = columnFactory.build({ children: [card] });

			const board = columnBoardFactory.build({
				children: [column],
			});

			await repo.save(board);
			em.clear();

			return { board, column, card };
		};

		it('should be able to find a node tree by root id', async () => {
			const { board, column, card } = await setup();

			const result = await repo.findById(board.id);

			// TODO implement tree matcher (by id)?
			expect(result.id).toEqual(board.id);
			expect(result.children[0].id).toEqual(column.id);
			expect(result.children[0].children[0].id).toEqual(card.id);
		});
	});

	describe('findByIds', () => {
		const setup = async () => {
			const board = columnBoardFactory.build({
				children: columnFactory.buildList(1, { children: cardFactory.buildList(1) }),
			});

			const extraBoard = columnBoardFactory.build({
				children: columnFactory.buildList(1, { children: cardFactory.buildList(1) }),
			});

			await repo.save([board, extraBoard]);
			em.clear();

			return { board, extraBoard };
		};

		it('should be able to find multiple board nodes', async () => {
			const { board, extraBoard } = await setup();

			const result = await repo.findByIds([board.id, extraBoard.id]);

			expect(result[0]).toBeInstanceOf(ColumnBoard);
			expect(result[1]).toBeInstanceOf(ColumnBoard);
		});

		it('should be able to limit tree depth', async () => {
			const { board } = await setup();

			const result = (await repo.findByIds([board.id], 1))[0];

			expect(result.children[0].children).toHaveLength(0);
		});
	});

	describe('findByExternalReference', () => {
		it.todo('should be able to find nodes by their external reference');
		it.todo('should populate the node tree');
		describe('when depth is specified', () => {
			it.todo('should limit the tree to depth');
		});
	});

	describe('findByContextExternalToolIds', () => {
		it.todo('should be able to find nodes by their external tool ids');
		it.todo('should populate the node tree');
		describe('when depth is specified', () => {
			it.todo('should limit the tree to depth');
		});
	});

	// describe('findCommonParentOfIds', () => {
	// 	const setup = async () => {
	// 		const card = cardFactory.build();
	// 		const column = columnFactory.build({ children: [card] });
	// 		const board = columnBoardFactory.build({ children: [column] });

	// 		await repo.save(board);
	// 		em.clear();

	// 		return { board, column, card };
	// 	};

	// 	it('should find the common parent', async () => {
	// 		const { board, column, card } = await setup();

	// 		const result = await repo.findCommonParentOfIds([column.id, card.id]);

	// 		expect(result.id).toEqual(board.id);
	// 	});
	// });

	describe('findAssignmentElementsByBoardIds', () => {
		const setupBoard = async () => {
			const element = assignmentElementFactory.build();
			const board = columnBoardFactory.build({
				context: { type: BoardExternalReferenceType.Room, id: '000000000000000000000001' },
				children: [columnFactory.build({ children: [cardFactory.build({ children: [element] })] })],
			});
			await repo.save(board);
			em.clear();

			return { board, element };
		};

		it('should find assignment elements of the given boards', async () => {
			const { board, element } = await setupBoard();

			const result = await repo.findAssignmentElementsByBoardIds([board.id]);

			expect(result).toHaveLength(1);
			expect(result[0].id).toEqual(element.id);
		});

		it('should return nothing for boards without assignments', async () => {
			await setupBoard();
			const otherBoard = columnBoardFactory.build();

			const result = await repo.findAssignmentElementsByBoardIds([otherBoard.id]);

			expect(result).toHaveLength(0);
		});

		it('should return nothing for an empty board list', async () => {
			await setupBoard();

			const result = await repo.findAssignmentElementsByBoardIds([]);

			expect(result).toHaveLength(0);
		});
	});

	describe('findAssignmentSubmissionsByParentIds', () => {
		const setupElementWithSubmissions = async () => {
			const submissionOfUser1 = assignmentSubmissionFactory.build({ userId: '0000000000000000000000a1' });
			const submissionOfUser2 = assignmentSubmissionFactory.build({ userId: '0000000000000000000000a2' });
			const element = assignmentElementFactory.build({ children: [submissionOfUser1, submissionOfUser2] });
			const board = columnBoardFactory.build({
				context: { type: BoardExternalReferenceType.Room, id: '000000000000000000000001' },
				children: [columnFactory.build({ children: [cardFactory.build({ children: [element] })] })],
			});
			await repo.save(board);
			em.clear();

			return { element, submissionOfUser1, submissionOfUser2 };
		};

		it('should find all submissions of the given elements', async () => {
			const { element, submissionOfUser1, submissionOfUser2 } = await setupElementWithSubmissions();

			const result = await repo.findAssignmentSubmissionsByParentIds([element.id]);

			expect(result).toHaveLength(2);
			expect(result.map((s) => s.id).sort()).toEqual([submissionOfUser1.id, submissionOfUser2.id].sort());
		});

		it('should filter submissions by userId', async () => {
			const { element, submissionOfUser1 } = await setupElementWithSubmissions();

			const result = await repo.findAssignmentSubmissionsByParentIds([element.id], '0000000000000000000000a1');

			expect(result).toHaveLength(1);
			expect(result[0].id).toEqual(submissionOfUser1.id);
		});

		it('should not find submissions of other elements', async () => {
			await setupElementWithSubmissions();
			const otherElement = assignmentElementFactory.build();

			const result = await repo.findAssignmentSubmissionsByParentIds([otherElement.id]);

			expect(result).toHaveLength(0);
		});
	});

	describe('delete', () => {
		const setup = async () => {
			const board = columnBoardFactory.build({
				children: columnFactory.buildList(1, { children: cardFactory.buildList(1) }),
			});

			await repo.save(board);

			return { board };
		};

		it('should delete all nodes recursivevely', async () => {
			const { board } = await setup();
			expect(await em.count(BoardNodeEntity)).toBe(3);

			await repo.delete(board);

			expect(await em.count(BoardNodeEntity)).toBe(0);
		});
	});

	describe('identity map', () => {
		const setup = async () => {
			const cards = cardFactory.buildList(2);
			const column = columnFactory.build({ children: cards });
			const board = columnBoardFactory.build({ children: [column] });

			await repo.save(board);
			em.clear();

			return { boardId: board.id, columnId: column.id, cardIds: cards.map((c) => c.id) };
		};

		describe('when loading a node twice', () => {
			it('should keep referential identity', async () => {
				const { boardId } = await setup();

				const result1 = await repo.findById(boardId);
				const result2 = await repo.findById(boardId);

				expect(result1 === result2).toBe(true);
			});
		});

		describe('when loading a child', () => {
			it('should ensure referential identity', async () => {
				const { boardId, columnId } = await setup();

				const resultBoard = await repo.findById(boardId);
				const resultColumn = await repo.findById(columnId);

				expect(resultColumn === resultBoard.children[0]).toBe(true);
			});
		});

		describe('when loading a parent', () => {
			it('should ensure referential identity', async () => {
				const { boardId, columnId } = await setup();

				const resultColumn = await repo.findById(columnId);
				const resultBoard = await repo.findById(boardId);

				expect(resultColumn === resultBoard.children[0]).toBe(true);
			});

			describe('with limited depth', () => {
				it('should keep referential identity', async () => {
					const { boardId, columnId } = await setup();

					const resultColumn = await repo.findById(columnId);
					const resultBoard = await repo.findById(boardId, 1);

					expect(resultBoard.children[0] === resultColumn).toBe(true);
				});

				it('should not overwrite any descendants', async () => {
					const { boardId, columnId, cardIds } = await setup();

					const resultColumn = await repo.findById(columnId);
					await repo.findById(boardId, 1);
					const resultCard1 = await repo.findById(cardIds[0]);
					const resultCard2 = await repo.findById(cardIds[1]);

					expect(resultColumn.children[0] === resultCard1).toBe(true);
					expect(resultColumn.children[1] === resultCard2).toBe(true);
				});
			});
		});
	});
});
