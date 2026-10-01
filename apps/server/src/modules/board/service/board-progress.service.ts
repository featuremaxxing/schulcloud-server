import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import {
	AnyContentElement,
	AssignmentSubmission,
	BoardNodeAuthorizable,
	BoardNodeType,
	ColumnBoard,
	computeItemProgress,
	isAssignmentElement,
	isCard,
	isCheckboxElement,
	isPollElement,
	type ItemProgress,
	pathSegmentOf,
	PollVote,
	type ProgressSummary,
	summarize,
	type UserWithBoardRoles,
} from '../domain';
import { BoardNodeRepo } from '../repo/board-node.repo';
import { BoardNodeService } from './board-node.service';

export type ProgressItemType = 'checkbox' | 'assignment' | 'poll';

export interface ProgressStudentResult {
	userId: EntityId;
	firstName?: string;
	lastName?: string;
	done: boolean;
}

export interface ProgressItemResult {
	type: ProgressItemType;
	elementId: EntityId;
	cardId: EntityId;
	cardTitle?: string;
	title: string;
	dueDate?: Date;
	// The requesting user's own eligibility/completion - meaningful for the student view,
	// harmless (and usually false/false) for the teacher view.
	eligible: boolean;
	done: boolean;
	doneCount: number;
	eligibleCount: number;
	// Only populated for the teacher view when explicitly requested (?details=true).
	students?: ProgressStudentResult[];
}

export interface BoardProgressResult {
	boardId: EntityId;
	boardTitle: string;
	isTeacherView: boolean;
	summary: ProgressSummary;
	items: ProgressItemResult[];
}

export interface BoardWithAuth {
	board: ColumnBoard;
	auth: BoardNodeAuthorizable;
	isTeacherView: boolean;
}

const elementType = (element: AnyContentElement): ProgressItemType => {
	if (isCheckboxElement(element)) return 'checkbox';
	if (isAssignmentElement(element)) return 'assignment';
	return 'poll';
};

const titleOf = (element: AnyContentElement): string => {
	if (isCheckboxElement(element)) return element.text;
	if (isAssignmentElement(element)) return element.title;
	if (isPollElement(element)) return element.title ?? '';
	return '';
};

// Aggregates checkbox/assignment/poll completion into per-board progress bars and an
// item list, for both the board-progress and the room-progress endpoints (the latter
// just calls this once per board). Kept free of authorisation/config concerns - callers
// decide which boards are visible and which element types are enabled.
@Injectable()
export class BoardProgressService {
	constructor(
		private readonly boardNodeRepo: BoardNodeRepo,
		private readonly boardNodeService: BoardNodeService
	) {}

	public async computeBoardsProgress(
		userId: EntityId,
		boards: BoardWithAuth[],
		enabledTypes: BoardNodeType[],
		options: { includeStudents?: boolean } = {}
	): Promise<BoardProgressResult[]> {
		if (boards.length === 0 || enabledTypes.length === 0) {
			return boards.map((entry) => this.emptyResult(entry));
		}

		const boardIds = boards.map((entry) => entry.board.id);
		const elements = (await this.boardNodeRepo.findElementsByBoardIds(boardIds, enabledTypes)) as AnyContentElement[];

		const now = new Date();
		const boardById = new Map(boards.map((entry) => [entry.board.id, entry]));
		// Assignments not yet started are invisible to students, consistent with the board
		// element hiding itself before startDate (see AssignmentUc.listAssignments).
		const visibleElements = elements.filter((element) => {
			if (!isAssignmentElement(element)) return true;
			const boardId = pathSegmentOf(element, 0);
			const entry = boardId ? boardById.get(boardId) : undefined;
			return !entry || entry.isTeacherView || element.isStartedAt(now);
		});

		const [submissions, votes] = await Promise.all([
			this.boardNodeRepo.findAssignmentSubmissionsByParentIds(
				visibleElements.filter(isAssignmentElement).map((element) => element.id)
			),
			this.boardNodeRepo.findPollVotesByParentIds(visibleElements.filter(isPollElement).map((element) => element.id)),
		]);

		const cardIds = Array.from(
			new Set(visibleElements.map((element) => pathSegmentOf(element, 2)).filter((id): id is EntityId => !!id))
		);
		const cards = cardIds.length > 0 ? await this.boardNodeService.findByIds(cardIds, 0) : [];
		const cardTitleById = new Map(cards.filter(isCard).map((card) => [card.id, card.title]));

		return boards.map((entry) => {
			const boardElements = visibleElements.filter((element) => pathSegmentOf(element, 0) === entry.board.id);
			const items: ProgressItemResult[] = [];
			const progresses: ItemProgress[] = [];

			for (const element of boardElements) {
				const children = this.childrenOf(element, submissions, votes);
				const progress = computeItemProgress(element, children, entry.auth.users);
				if (!progress || progress.eligibleUserIds.length === 0) continue;

				progresses.push(progress);

				const cardId = pathSegmentOf(element, 2) as EntityId;
				const item: ProgressItemResult = {
					type: elementType(element),
					elementId: element.id,
					cardId,
					cardTitle: cardTitleById.get(cardId),
					title: titleOf(element),
					dueDate: isAssignmentElement(element) ? element.dueDate : undefined,
					eligible: progress.eligibleUserIds.includes(userId),
					done: progress.doneUserIds.includes(userId),
					doneCount: progress.doneUserIds.length,
					eligibleCount: progress.eligibleUserIds.length,
				};
				if (entry.isTeacherView && options.includeStudents) {
					item.students = progress.eligibleUserIds.map((eligibleUserId) => {
						const member = entry.auth.users.find((user) => user.userId === eligibleUserId);
						return {
							userId: eligibleUserId,
							firstName: member?.firstName,
							lastName: member?.lastName,
							done: progress.doneUserIds.includes(eligibleUserId),
						};
					});
				}
				items.push(item);
			}

			const summary = entry.isTeacherView
				? summarize(progresses)
				: {
						done: items.filter((item) => item.eligible && item.done).length,
						total: items.filter((item) => item.eligible).length,
					};

			return {
				boardId: entry.board.id,
				boardTitle: entry.board.title,
				isTeacherView: entry.isTeacherView,
				summary,
				items,
			};
		});
	}

	// Who has completed each board: a person is done with a board when it has at least one
	// progress item for them and they finished all of them. Assignments that have not started
	// yet do not count, as in the student view above. Also who has progress items on the board
	// at all, so a board without any can be told from one that is not done yet. Used by learning paths.
	public async computeCompletedUserIds(
		boards: { board: ColumnBoard; users: UserWithBoardRoles[] }[],
		enabledTypes: BoardNodeType[]
	): Promise<{ done: Map<EntityId, Set<EntityId>>; withItems: Map<EntityId, Set<EntityId>> }> {
		const done = new Map<EntityId, Set<EntityId>>(boards.map((entry) => [entry.board.id, new Set<EntityId>()]));
		const withItems = new Map<EntityId, Set<EntityId>>(boards.map((entry) => [entry.board.id, new Set<EntityId>()]));
		if (boards.length === 0 || enabledTypes.length === 0) {
			return { done, withItems };
		}

		const elements = (await this.boardNodeRepo.findElementsByBoardIds(
			boards.map((entry) => entry.board.id),
			enabledTypes
		)) as AnyContentElement[];
		const now = new Date();
		const visibleElements = elements.filter((element) => !isAssignmentElement(element) || element.isStartedAt(now));

		const [submissions, votes] = await Promise.all([
			this.boardNodeRepo.findAssignmentSubmissionsByParentIds(
				visibleElements.filter(isAssignmentElement).map((element) => element.id)
			),
			this.boardNodeRepo.findPollVotesByParentIds(visibleElements.filter(isPollElement).map((element) => element.id)),
		]);

		for (const entry of boards) {
			const progresses = visibleElements
				.filter((element) => pathSegmentOf(element, 0) === entry.board.id)
				.map((element) => computeItemProgress(element, this.childrenOf(element, submissions, votes), entry.users))
				.filter((progress): progress is ItemProgress => !!progress);

			const boardDone = done.get(entry.board.id) as Set<EntityId>;
			const boardWithItems = withItems.get(entry.board.id) as Set<EntityId>;
			for (const user of entry.users) {
				const own = progresses.filter((progress) => progress.eligibleUserIds.includes(user.userId));
				if (own.length > 0) {
					boardWithItems.add(user.userId);
				}
				if (own.length > 0 && own.every((progress) => progress.doneUserIds.includes(user.userId))) {
					boardDone.add(user.userId);
				}
			}
		}

		return { done, withItems };
	}

	// Whether the board has at least one progress item for the given person - without one,
	// a learning path lets them mark the board as done by hand.
	public async hasProgressItemsFor(
		board: ColumnBoard,
		user: UserWithBoardRoles,
		enabledTypes: BoardNodeType[]
	): Promise<boolean> {
		if (enabledTypes.length === 0) return false;

		const elements = (await this.boardNodeRepo.findElementsByBoardIds([board.id], enabledTypes)) as AnyContentElement[];
		const now = new Date();

		return elements
			.filter((element) => !isAssignmentElement(element) || element.isStartedAt(now))
			.some((element) => computeItemProgress(element, [], [user])?.eligibleUserIds.includes(user.userId));
	}

	private childrenOf(
		element: AnyContentElement,
		submissions: AssignmentSubmission[],
		votes: PollVote[]
	): (AssignmentSubmission | PollVote)[] {
		if (isAssignmentElement(element)) {
			return submissions.filter((submission) => submission.path.endsWith(`,${element.id},`));
		}
		if (isPollElement(element)) {
			return votes.filter((vote) => vote.path.endsWith(`,${element.id},`));
		}
		return [];
	}

	private emptyResult(entry: BoardWithAuth): BoardProgressResult {
		return {
			boardId: entry.board.id,
			boardTitle: entry.board.title,
			isTeacherView: entry.isTeacherView,
			summary: { done: 0, total: 0 },
			items: [],
		};
	}
}
