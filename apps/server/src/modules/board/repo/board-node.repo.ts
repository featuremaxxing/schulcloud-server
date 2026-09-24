import { FilterQuery, Utils } from '@mikro-orm/core';
import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { ConflictException, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import {
	AnyBoardNode,
	AssignmentElement,
	AssignmentSubmission,
	AiQuestionAnswer,
	BoardExternalReference,
	BoardNodeType,
	CheckboxEntry,
	PollAudience,
	BoardRoles,
	getBoardNodeType,
	PollVote,
} from '../domain';
import { pathOfChildren } from '../domain/path-utils';
import { BoardNodeEntity } from './entity/board-node.entity';
import { TreeBuilder } from './tree-builder';

@Injectable()
export class BoardNodeRepo {
	constructor(private readonly em: EntityManager) {}

	public async findById(id: EntityId, depth?: number): Promise<AnyBoardNode> {
		const props = await this.em.findOneOrFail(BoardNodeEntity, { id });
		const descendants = await this.findDescendants(props, depth);

		const builder = new TreeBuilder(descendants);
		const boardNode = builder.build(props);

		return boardNode;
	}

	public async findByIds(ids: EntityId[], depth?: number): Promise<AnyBoardNode[]> {
		const entities = await this.em.find(BoardNodeEntity, { id: { $in: ids } });

		// TODO refactor descendants mapping, more DRY?
		const descendantsMap = await this.findDescendantsOfMany(entities, depth);

		const boardNodes = entities.map((props) => {
			const descentants = descendantsMap[pathOfChildren(props)];
			const builder = new TreeBuilder(descentants);
			const boardNode = builder.build(props);

			return boardNode;
		});

		return boardNodes;
	}

	public async findByExternalReference(reference: BoardExternalReference, depth?: number): Promise<AnyBoardNode[]> {
		const entities = await this.em.find(BoardNodeEntity, {
			context: {
				_contextId: new ObjectId(reference.id),
				_contextType: reference.type,
			} as FilterQuery<BoardExternalReference>,
		});

		// TODO refactor descendants mapping, more DRY?
		const descendantsMap = await this.findDescendantsOfMany(entities, depth);

		const boardNodes = entities.map((props) => {
			const children = descendantsMap[pathOfChildren(props)];
			const builder = new TreeBuilder(children);
			const boardNode = builder.build(props);

			return boardNode;
		});

		return boardNodes;
	}

	public async findByContextExternalToolIds(
		contextExternalToolIds: EntityId[],
		depth?: number
	): Promise<AnyBoardNode[]> {
		const entities = await this.em.find(BoardNodeEntity, {
			contextExternalToolId: { $in: contextExternalToolIds },
		});

		// TODO refactor descendants mapping, more DRY?
		const descendantsMap = await this.findDescendantsOfMany(entities, depth);

		const boardNodes = entities.map((props) => {
			const children = descendantsMap[pathOfChildren(props)];
			const builder = new TreeBuilder(children);
			const boardNode = builder.build(props);

			return boardNode;
		});

		return boardNodes;
	}

	public async save(boardNode: AnyBoardNode | AnyBoardNode[]): Promise<void> {
		await this.persist(boardNode).flush();
	}

	// Compare-and-swap the complete entries array. Concurrent students can never overwrite
	// each other's updates: a loser rereads the latest array and retries the mutation.
	public async mutateCheckboxEntries(
		id: EntityId,
		change: (entries: CheckboxEntry[]) => CheckboxEntry[]
	): Promise<CheckboxEntry[]> {
		const collection = this.em.getCollection(BoardNodeEntity);
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const current = await collection.findOne({ _id: new ObjectId(id), type: BoardNodeType.CHECKBOX_ELEMENT });
			if (!current) throw new ConflictException('Checkbox was removed');
			const before = current.entries;
			const after = change(
				(before ?? []).map((entry) => {
					return { ...entry };
				})
			);
			if (JSON.stringify(after) === JSON.stringify(before ?? [])) return after;
			const result = await collection.updateOne(
				{ _id: current._id, type: BoardNodeType.CHECKBOX_ELEMENT, entries: before ?? { $exists: false } },
				{ $set: { entries: after, updatedAt: new Date() } }
			);
			if (result.modifiedCount === 1) return after;
		}
		throw new ConflictException('Concurrent checkbox update; retry the request');
	}

	public async updateCheckboxContent(
		id: EntityId,
		text: string,
		mode: boolean,
		previousMode: boolean,
		audience: PollAudience = PollAudience.STUDENTS,
		previousAudience: PollAudience = PollAudience.STUDENTS,
		audienceRoles?: BoardRoles[],
		previousAudienceRoles?: BoardRoles[]
	): Promise<void> {
		const collection = this.em.getCollection(BoardNodeEntity);
		const rolesChanged = JSON.stringify(audienceRoles ?? []) !== JSON.stringify(previousAudienceRoles ?? []);
		const result = await collection.updateOne(
			{
				_id: new ObjectId(id),
				type: BoardNodeType.CHECKBOX_ELEMENT,
				...(mode !== previousMode || audience !== previousAudience || rolesChanged
					? { $or: [{ entries: { $exists: false } }, { entries: { $size: 0 } }] }
					: {}),
				// A stale teacher request may not silently revert a concurrent mode change.
				$and: [
					{ $or: [{ requireTeacherConfirmation: previousMode }, { requireTeacherConfirmation: { $exists: false } }] },
					{ $or: [{ audience: previousAudience }, { audience: { $exists: false } }] },
					{ $or: [{ audienceRoles: previousAudienceRoles ?? [] }, { audienceRoles: { $exists: false } }] },
				],
			},
			{
				$set: {
					text,
					requireTeacherConfirmation: mode,
					audience,
					audienceRoles: audienceRoles ?? [],
					updatedAt: new Date(),
				},
			}
		);
		if (!result.matchedCount) throw new ConflictException('Confirmation mode cannot change after checkbox activity');
	}

	// Direct children of the given poll elements. Matches paths ending in ',<elementId>,' -
	// only votes can be direct children of a poll element. Passing userId narrows to a
	// single participant's vote, used by the vote handler to find an existing vote to update.
	public async findPollVotesByParentIds(parentIds: EntityId[], userId?: EntityId): Promise<PollVote[]> {
		if (parentIds.length === 0) {
			return [];
		}

		// Every current caller passes an @IsMongoId()-validated id, which can never contain a
		// regex metacharacter - but that's an invariant of the callers, not of this method, so it
		// is escaped here too rather than trusted. One $or clause per id (each a simple anchored
		// literal, not joined into one `(a|b|c)` alternation) keeps this from ever becoming a
		// regex-injection or backtracking concern regardless of what a future caller passes in.
		const votes = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.POLL_VOTE,
			$or: parentIds.map((parentId) => {
				return { path: { $re: `,${escapeRegExp(parentId)},$` } };
			}),
			...(userId ? { userId } : {}),
		});

		return votes.map((entity) => new TreeBuilder().build(entity)) as PollVote[];
	}

	// Light-weight overview query for the assignment list: instead of loading entire
	// board trees (findByExternalReference), it loads the assignment elements of the
	// given boards. The caller must pass the boards the rooms actually reference
	// (RoomContentService.getBoardOrder) - a room's database can contain older boards
	// that are no longer linked, and their assignments must not surface in the list.
	// With onlyVisible, boards in draft state (isVisible=false) are skipped - students
	// cannot open them (canFindBoard rejects non-editors), so the list must not offer
	// deep links into them either.
	public async findAssignmentElementsByBoardIds(
		boardIds: EntityId[],
		options: { onlyVisible?: boolean } = {}
	): Promise<AssignmentElement[]> {
		if (boardIds.length === 0) {
			return [];
		}

		let reachableBoardIds = boardIds;
		if (options.onlyVisible) {
			const boards = await this.em.find(BoardNodeEntity, {
				type: BoardNodeType.COLUMN_BOARD,
				id: { $in: boardIds },
			});
			reachableBoardIds = boards.filter((board) => board.isVisible).map((board) => board.id);
		}

		if (reachableBoardIds.length === 0) {
			return [];
		}

		// An element's path starts with its board's id: ',<boardId>,<columnId>,...' (ROOT_PATH=',').
		// One $or clause per id (each a simple anchored literal) instead of one `(a|b|c)`
		// alternation: Mongo cannot use the path index for an alternation at all, whereas a
		// single anchored-prefix literal per clause can still use it. Also escaped, matching
		// findPollVotesByParentIds below - ids are @IsMongoId()-validated by every current caller
		// and can never contain a regex metacharacter, but that is an invariant of the callers,
		// not of this method.
		const elements = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.ASSIGNMENT_ELEMENT,
			$or: reachableBoardIds.map((boardId) => {
				return { path: { $re: `^,${escapeRegExp(boardId)},` } };
			}),
		});

		return elements.map((entity) => new TreeBuilder().build(entity)) as AssignmentElement[];
	}

	// Direct children of the given assignment elements. Matches paths ending in
	// ',<elementId>,' - only submissions can be direct children of an assignment element.
	public async findAssignmentSubmissionsByParentIds(
		parentIds: EntityId[],
		userId?: EntityId
	): Promise<AssignmentSubmission[]> {
		if (parentIds.length === 0) {
			return [];
		}

		// See findAssignmentElementsByBoardIds above for why this is a $or of per-id clauses
		// rather than one `(a|b|c)` alternation.
		const submissions = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.ASSIGNMENT_SUBMISSION,
			$or: parentIds.map((parentId) => {
				return { path: { $re: `,${escapeRegExp(parentId)},$` } };
			}),
			...(userId ? { userId } : {}),
		});

		return submissions.map((entity) => new TreeBuilder().build(entity)) as AssignmentSubmission[];
	}

	// Direct children of the given AI question elements. Matches paths ending in
	// ',<elementId>,' - only answers can be direct children of an ai-question element.
	public async findAiQuestionAnswersByParentIds(parentIds: EntityId[], userId?: EntityId): Promise<AiQuestionAnswer[]> {
		if (parentIds.length === 0) {
			return [];
		}

		// See findAssignmentElementsByBoardIds above for why this is a $or of per-id clauses
		// rather than one `(a|b|c)` alternation.
		const answers = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.AI_QUESTION_ANSWER,
			$or: parentIds.map((parentId) => {
				return { path: { $re: `,${escapeRegExp(parentId)},$` } };
			}),
			...(userId ? { userId } : {}),
		});

		return answers.map((entity) => new TreeBuilder().build(entity)) as AiQuestionAnswer[];
	}

	public async delete(boardNode: AnyBoardNode | AnyBoardNode[]): Promise<void> {
		await this.remove(boardNode).flush();
	}

	private async findDescendants(props: BoardNodeEntity, depth?: number): Promise<BoardNodeEntity[]> {
		const levelQuery = depth !== undefined ? { $gt: props.level, $lte: props.level + depth } : { $gt: props.level };

		const descendants = await this.em.find(BoardNodeEntity, {
			path: { $re: `^${pathOfChildren(props)}` },
			level: levelQuery,
		});

		return descendants;
	}

	private async findDescendantsOfMany(
		entities: BoardNodeEntity[],
		depth?: number
	): Promise<Record<string, BoardNodeEntity[]>> {
		const pathQueries = entities.map((props) => {
			const levelQuery = depth !== undefined ? { $gt: props.level, $lte: props.level + depth } : { $gt: props.level };

			return { path: { $re: `^${pathOfChildren(props)}` }, level: levelQuery };
		});

		const map: Record<string, BoardNodeEntity[]> = {};
		if (pathQueries.length === 0) {
			return map;
		}

		const descendants = await this.em.find(BoardNodeEntity, {
			$or: pathQueries,
		});

		// this is for finding the ancestors of a descendant
		// we use this to group the descendants by ancestor
		// TODO we probably need a more efficient way to do the grouping
		const matchAncestors = (descendant: BoardNodeEntity): BoardNodeEntity[] => {
			const result = entities.filter((props) => descendant.path.match(`^${pathOfChildren(props)}`));
			return result;
		};

		for (const desc of descendants) {
			const ancestors = matchAncestors(desc);
			ancestors.forEach((props) => {
				map[pathOfChildren(props)] ||= [];
				map[pathOfChildren(props)].push(desc);
			});
		}
		return map;
	}

	private persist(boardNode: AnyBoardNode | AnyBoardNode[]): BoardNodeRepo {
		const boardNodes = Utils.asArray(boardNode);

		boardNodes.forEach((bn) => {
			bn.children.forEach((child) => this.persist(child));

			const props = this.getProps(bn);

			if (!(props instanceof BoardNodeEntity)) {
				const entity = this.em.create(BoardNodeEntity, props);
				entity.type = getBoardNodeType(bn);
				this.setProps(bn, entity);
				this.em.persist(entity);
			} else {
				// for the unlikely case that the props are not managed yet
				this.em.persist(props);
			}
		});

		return this;
	}

	private remove(boardNode: AnyBoardNode | AnyBoardNode[]): BoardNodeRepo {
		const boardNodes = Utils.asArray(boardNode);

		boardNodes.forEach((bn) => {
			this.em.remove(this.getProps(bn));
			bn.children.forEach((child) => this.remove(child));
		});

		return this;
	}

	private async flush(): Promise<void> {
		await this.em.flush();
	}

	private getProps(boardNode: AnyBoardNode): BoardNodeEntity {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		const { props } = boardNode;
		return props as BoardNodeEntity;
	}

	private setProps(boardNode: AnyBoardNode, props: BoardNodeEntity): void {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		boardNode.props = props;
	}
}

// See findAssignmentElementsByBoardIds/findAssignmentSubmissionsByParentIds/findPollVotesByParentIds -
// escapes every character with special meaning in a regex so a value embedded into a $re query
// can never be read as anything but a literal string.
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
