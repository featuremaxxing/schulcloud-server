import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { BaseEntityWithTimestamps } from '@shared/domain/entity';
import { cleanupCollections } from '@testing/cleanup-collections';
import { MongoMemoryDatabaseModule } from '@testing/database';
import {
	BoardExternalReferenceType,
	BoardRoles,
	BoardNodeType,
	ColumnBoard,
	PollAnswerMode,
	PollAudience,
	PollChartType,
	type PollElement,
	PollStatus,
	type PollVote,
} from '../domain';
import {
	assignmentElementFactory,
	assignmentSubmissionFactory,
	cardFactory,
	checkboxElementFactory,
	columnBoardFactory,
	columnFactory,
	pollElementFactory,
	pollVoteFactory,
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

	describe('checkbox atomic updates', () => {
		const create = async () => {
			const id = new ObjectId().toHexString();
			await em.getCollection(BoardNodeEntity).insertOne({
				_id: new ObjectId(id),
				type: BoardNodeType.CHECKBOX_ELEMENT,
				path: ',',
				level: 0,
				position: 0,
				text: 'Task',
				requireTeacherConfirmation: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as BoardNodeEntity);
			return id;
		};

		it('keeps simultaneous student check states and prevents a late mode switch', async () => {
			const id = await create();
			const students = [new ObjectId().toHexString(), new ObjectId().toHexString()];
			await Promise.all(
				students.map((userId) =>
					repo.mutateCheckboxEntries(id, (entries) => {
						entries.push({ userId, checked: true, approved: false });
						return entries;
					})
				)
			);
			const stored = await em.getCollection(BoardNodeEntity).findOne({ _id: new ObjectId(id) });
			expect(stored?.entries?.map((entry) => entry.userId).sort()).toEqual(students.sort());
			await expect(repo.updateCheckboxContent(id, 'Changed', true, true)).rejects.toThrow(ConflictException);
			await repo.updateCheckboxContent(id, 'Text can still change', false, false);
			await repo.updateCheckboxContent(id, 'Text still editable repeatedly', false, false);
			const unchanged = await em.getCollection(BoardNodeEntity).findOne({ _id: new ObjectId(id) });
			expect(unchanged?.entries).toHaveLength(2);
		});

		it('lets the teacher set confirmation mode before activity, but rejects stale mode updates', async () => {
			const id = await create();
			await repo.updateCheckboxContent(id, 'Mode on', true, false);
			await expect(repo.updateCheckboxContent(id, 'Stale mode off', false, false)).rejects.toThrow(ConflictException);
			const stored = await em.getCollection(BoardNodeEntity).findOne({ _id: new ObjectId(id) });
			expect(stored?.requireTeacherConfirmation).toBe(true);
		});

		it('locks audience and custom roles after an initial check, including after uncheck', async () => {
			const id = await create();
			await repo.updateCheckboxContent(id, 'Task', false, false, PollAudience.CUSTOM, PollAudience.STUDENTS, [
				BoardRoles.READER,
			]);
			const userId = new ObjectId().toHexString();
			await repo.mutateCheckboxEntries(id, (entries) => [...entries, { userId, checked: false, approved: false }]);
			await expect(
				repo.updateCheckboxContent(
					id,
					'Task',
					false,
					false,
					PollAudience.CUSTOM,
					PollAudience.CUSTOM,
					[BoardRoles.EDITOR],
					[BoardRoles.READER]
				)
			).rejects.toThrow(ConflictException);
			await expect(
				repo.updateCheckboxContent(id, 'Task', false, false, PollAudience.ALL, PollAudience.CUSTOM, undefined, [
					BoardRoles.READER,
				])
			).rejects.toThrow(ConflictException);
		});

		it('keeps activity after unchecking and rejects changing an approved student state', async () => {
			const id = await create();
			const userId = new ObjectId().toHexString();
			await repo.mutateCheckboxEntries(id, (entries) => [...entries, { userId, checked: true, approved: false }]);
			await repo.mutateCheckboxEntries(id, (entries) =>
				entries.map((entry) => {
					return { ...entry, checked: false };
				})
			);
			await expect(repo.updateCheckboxContent(id, 'Text', true, true)).rejects.toThrow(ConflictException);
			await repo.mutateCheckboxEntries(id, (entries) =>
				entries.map((entry) => {
					return { ...entry, checked: true, approved: true };
				})
			);
			await expect(
				repo.mutateCheckboxEntries(id, (entries) => {
					if (entries[0].approved) throw new ForbiddenException();
					return entries;
				})
			).rejects.toThrow(ForbiddenException);
		});
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

	describe('findElementsByBoardIds', () => {
		const setupBoard = async () => {
			const assignment = assignmentElementFactory.build();
			const checkbox = checkboxElementFactory.build();
			const board = columnBoardFactory.build({
				context: { type: BoardExternalReferenceType.Room, id: '000000000000000000000001' },
				children: [columnFactory.build({ children: [cardFactory.build({ children: [assignment, checkbox] })] })],
			});
			await repo.save(board);
			em.clear();

			return { board, assignment, checkbox };
		};

		it('should find elements of several requested types on the given boards', async () => {
			const { board, assignment, checkbox } = await setupBoard();

			const result = await repo.findElementsByBoardIds(
				[board.id],
				[BoardNodeType.ASSIGNMENT_ELEMENT, BoardNodeType.CHECKBOX_ELEMENT]
			);

			expect(result.map((element) => element.id).sort()).toEqual([assignment.id, checkbox.id].sort());
		});

		it('should only return the requested type', async () => {
			const { board, checkbox } = await setupBoard();

			const result = await repo.findElementsByBoardIds([board.id], [BoardNodeType.CHECKBOX_ELEMENT]);

			expect(result).toHaveLength(1);
			expect(result[0].id).toEqual(checkbox.id);
		});

		it('should return nothing for an empty type list', async () => {
			const { board } = await setupBoard();

			const result = await repo.findElementsByBoardIds([board.id], []);

			expect(result).toHaveLength(0);
		});

		it('should skip draft boards when onlyVisible is set', async () => {
			const assignment = assignmentElementFactory.build();
			const board = columnBoardFactory.build({
				context: { type: BoardExternalReferenceType.Room, id: '000000000000000000000001' },
				isVisible: false,
				children: [columnFactory.build({ children: [cardFactory.build({ children: [assignment] })] })],
			});
			await repo.save(board);
			em.clear();

			const result = await repo.findElementsByBoardIds([board.id], [BoardNodeType.ASSIGNMENT_ELEMENT], {
				onlyVisible: true,
			});

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

	// The new part for the poll element: nested @Embedded arrays (questions with nested
	// options) plus a single nested @Embedded object (resultSnapshot with a nested array
	// of question results) - both persisted and reloaded as plain-data-shaped instances,
	// not the domain's own PollQuestion/PollResultSnapshot interfaces.
	describe('persisting nested embeddables (poll)', () => {
		const setup = () => {
			const userId = new ObjectId().toHexString();
			const optionA = { id: 'option-a', text: 'Option A' };
			const optionB = { id: 'option-b', text: 'Option B' };
			const question = {
				id: 'question-1',
				text: 'Which one?',
				answerMode: PollAnswerMode.SINGLE,
				chartType: PollChartType.BAR,
				options: [optionA, optionB],
			};

			const poll = pollElementFactory.build({
				title: 'My poll',
				questions: [question],
				isAnonymous: true,
				showResultsLive: true,
				pollStatus: PollStatus.CLOSED,
				closesAt: new Date('2026-01-10T10:00:00.000Z'),
				resultSnapshot: {
					frozenAt: new Date('2026-01-10T10:00:00.000Z'),
					participantCount: 2,
					perQuestion: [
						{
							questionId: question.id,
							counts: [
								{ optionId: optionA.id, count: 1 },
								{ optionId: optionB.id, count: 1 },
							],
						},
					],
				},
			});

			const vote = pollVoteFactory.build({
				userId,
				answers: [{ questionId: question.id, selectedOptionIds: [optionA.id] }],
			});
			poll.addChild(vote);

			return { poll, vote, userId };
		};

		it('should round-trip the questions array (nested embeddable array of arrays)', async () => {
			const { poll } = setup();

			await repo.save(poll);
			em.clear();

			const result = (await repo.findById(poll.id)) as PollElement;

			expect(result.questions).toHaveLength(1);
			expect(result.questions[0]).toMatchObject({
				id: 'question-1',
				text: 'Which one?',
				answerMode: PollAnswerMode.SINGLE,
				chartType: PollChartType.BAR,
			});
			expect(result.questions[0].options).toEqual([
				{ id: 'option-a', text: 'Option A' },
				{ id: 'option-b', text: 'Option B' },
			]);
		});

		it('should round-trip the resultSnapshot (nested embeddable object with a nested array)', async () => {
			const { poll } = setup();

			await repo.save(poll);
			em.clear();

			const result = (await repo.findById(poll.id)) as PollElement;

			expect(result.resultSnapshot?.participantCount).toBe(2);
			expect(result.resultSnapshot?.perQuestion).toHaveLength(1);
			expect(result.resultSnapshot?.perQuestion[0].counts).toEqual([
				{ optionId: 'option-a', count: 1 },
				{ optionId: 'option-b', count: 1 },
			]);
		});

		it('should round-trip a poll vote child with its answers', async () => {
			const { poll, vote, userId } = setup();

			await repo.save(poll);
			em.clear();

			const result = (await repo.findById(poll.id, 1)) as PollElement;
			const resultVote = result.children[0] as PollVote;

			expect(resultVote.userId).toBe(userId);
			expect(resultVote.answers).toEqual(vote.answers);
		});
	});

	describe('findPollVotesByParentIds', () => {
		const setup = async () => {
			const pollA = pollElementFactory.build();
			const pollB = pollElementFactory.build();
			const userId = new ObjectId().toHexString();
			const otherUserId = new ObjectId().toHexString();

			const voteA1 = pollVoteFactory.build({ userId });
			const voteA2 = pollVoteFactory.build({ userId: otherUserId });
			const voteB1 = pollVoteFactory.build({ userId });
			pollA.addChild(voteA1);
			pollA.addChild(voteA2);
			pollB.addChild(voteB1);

			await repo.save(pollA);
			await repo.save(pollB);
			em.clear();

			return { pollA, pollB, userId, otherUserId };
		};

		it('should return an empty array for an empty list of parent ids', async () => {
			const result = await repo.findPollVotesByParentIds([]);

			expect(result).toEqual([]);
		});

		it('should return only the votes belonging to the given parent element', async () => {
			const { pollA } = await setup();

			const result = await repo.findPollVotesByParentIds([pollA.id]);

			expect(result).toHaveLength(2);
			expect(result.every((vote) => vote.path.includes(pollA.id))).toBe(true);
		});

		it('should combine votes from multiple parent ids', async () => {
			const { pollA, pollB } = await setup();

			const result = await repo.findPollVotesByParentIds([pollA.id, pollB.id]);

			expect(result).toHaveLength(3);
		});

		it('should narrow to a single participant when userId is given', async () => {
			const { pollA, userId } = await setup();

			const result = await repo.findPollVotesByParentIds([pollA.id], userId);

			expect(result).toHaveLength(1);
			expect(result[0].userId).toBe(userId);
		});

		// Regression test for the query previously joining ids into one `(a|b|c)` regex
		// alternation without escaping - a parentId containing a regex metacharacter must be
		// matched literally (and match nothing here, since it names no real element) rather than
		// being interpreted as part of the pattern or throwing.
		it('should treat a parentId with regex metacharacters as a literal string', async () => {
			const result = await repo.findPollVotesByParentIds(['(.*)', 'a|b', '[unclosed']);

			expect(result).toEqual([]);
		});
	});
});
