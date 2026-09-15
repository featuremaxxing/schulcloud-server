import { FilterQuery, Utils } from '@mikro-orm/core';
import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import {
	AnyBoardNode,
	AssignmentElement,
	AssignmentSubmission,
	BoardExternalReference,
	BoardExternalReferenceType,
	BoardNodeType,
	getBoardNodeType,
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

	// Light-weight overview query for the assignment list: instead of loading entire
	// board trees per room (findByExternalReference), it only loads the room's board
	// roots and the assignment elements below them. Child nodes (e.g. submissions) do
	// not carry a context of their own - the room link is only on the root board.
	public async findAssignmentElementsByRoomIds(roomIds: EntityId[]): Promise<AssignmentElement[]> {
		if (roomIds.length === 0) {
			return [];
		}

		const boards = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.COLUMN_BOARD,
			context: {
				_contextId: { $in: roomIds.map((roomId) => new ObjectId(roomId)) },
				_contextType: BoardExternalReferenceType.Room,
			} as FilterQuery<BoardExternalReference>,
		});

		if (boards.length === 0) {
			return [];
		}

		// An element's path starts with its board's id: ',<boardId>,<columnId>,...' (ROOT_PATH=',').
		const boardIds = boards.map((board) => board.id);
		const elements = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.ASSIGNMENT_ELEMENT,
			path: { $re: `^,(${boardIds.join('|')}),` },
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

		const submissions = await this.em.find(BoardNodeEntity, {
			type: BoardNodeType.ASSIGNMENT_SUBMISSION,
			path: { $re: `,(${parentIds.join('|')}),$` },
			...(userId ? { userId } : {}),
		});

		return submissions.map((entity) => new TreeBuilder().build(entity)) as AssignmentSubmission[];
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
