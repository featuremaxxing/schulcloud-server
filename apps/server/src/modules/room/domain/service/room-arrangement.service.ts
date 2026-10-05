import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { RoomArrangementRepo } from '../../repo';
import { RoomArrangement, RoomArrangementItem, RoomCollection } from '../type';

@Injectable()
export class RoomArrangementService {
	constructor(private readonly roomArrangementRepo: RoomArrangementRepo) {}

	public async sortRoomIdsByUserArrangement(userId: EntityId, roomIds: EntityId[]): Promise<EntityId[]> {
		const arrangement = await this.getArrangement(userId, roomIds);

		return arrangement.items.map((item) => item.id);
	}

	public async getArrangement(userId: EntityId, availableRoomIds: EntityId[]): Promise<RoomArrangement> {
		const arrangementExists = await this.roomArrangementRepo.hasArrangementForUserId(userId);

		if (!arrangementExists) {
			await this.createArranagement(userId, availableRoomIds);

			return {
				items: availableRoomIds.map((id) => {
					return { id };
				}),
				collections: [],
			};
		}

		const arrangement = await this.sortAndUpdateArrangement(userId, availableRoomIds);

		return arrangement;
	}

	public async arrangeRooms(
		userId: EntityId,
		requestedItems: RoomArrangementItem[],
		requestedCollections: RoomCollection[]
	): Promise<void> {
		const knownItems = await this.roomArrangementRepo.findItemsByUserId(userId);
		const knownRoomIds = new Set(knownItems.map((item) => item.id));
		const collectionIds = new Set(requestedCollections.map((collection) => collection.id));

		const seenRoomIds = new Set<EntityId>();
		const items: RoomArrangementItem[] = [];
		for (const { id, collectionId } of requestedItems) {
			if (knownRoomIds.has(id) && !seenRoomIds.has(id)) {
				seenRoomIds.add(id);
				items.push(this.buildItem(id, collectionId && collectionIds.has(collectionId) ? collectionId : undefined));
			}
		}
		// rooms the client did not know about yet stay ungrouped at the end
		for (const { id } of knownItems) {
			if (!seenRoomIds.has(id)) items.push({ id });
		}

		const collections = this.keepUsedCollections(requestedCollections, items);

		await this.roomArrangementRepo.updateArrangement(userId, items, collections);
	}

	public async moveRoom(userId: EntityId, roomId: EntityId, toPosition: number): Promise<void> {
		const items = await this.roomArrangementRepo.findItemsByUserId(userId);

		if (toPosition < 0 || toPosition >= items.length) {
			throw new BadRequestException(`Invalid position ${toPosition} for room arrangement of user '${userId}'`);
		}

		const roomIndex = items.findIndex((item) => item.id === roomId);

		if (roomIndex === -1) {
			throw new BadRequestException(`Room with ID ${roomId} not found in arrangement of user '${userId}'`);
		}

		const [roomItem] = items.splice(roomIndex, 1);
		items.splice(toPosition, 0, roomItem);

		await this.roomArrangementRepo.updateArrangement(userId, items);
	}

	public async deleteArrangements(userId: EntityId): Promise<EntityId[]> {
		const deletedIds = await this.roomArrangementRepo.deleteArrangements(userId);

		return deletedIds;
	}

	private async createArranagement(userId: EntityId, roomIds: EntityId[]): Promise<void> {
		const items = roomIds.map((roomId): RoomArrangementItem => {
			return { id: roomId };
		});

		await this.roomArrangementRepo.createArrangement(userId, items);
	}

	private async sortAndUpdateArrangement(userId: EntityId, availableRoomIds: EntityId[]): Promise<RoomArrangement> {
		const arrangement = await this.roomArrangementRepo.findArrangementByUserId(userId);
		const roomIds = arrangement.items.map((item) => item.id);
		const collectionIdByRoomId = new Map(arrangement.items.map((item) => [item.id, item.collectionId]));

		const knownRoomIds = availableRoomIds
			.filter((roomId) => collectionIdByRoomId.has(roomId))
			.sort((a, b) => roomIds.indexOf(a) - roomIds.indexOf(b));
		const unknownRoomIds = availableRoomIds.filter((roomId) => !collectionIdByRoomId.has(roomId));

		const items: RoomArrangementItem[] = [
			...knownRoomIds.map((roomId) => this.buildItem(roomId, collectionIdByRoomId.get(roomId))),
			...unknownRoomIds.map((roomId) => this.buildItem(roomId)),
		];
		const collections = this.keepUsedCollections(arrangement.collections, items);
		const collectionIds = new Set(collections.map((collection) => collection.id));
		const cleanedItems = items.map((item) =>
			item.collectionId && !collectionIds.has(item.collectionId) ? this.buildItem(item.id) : item
		);

		await this.roomArrangementRepo.updateArrangement(userId, cleanedItems, collections);

		return { items: cleanedItems, collections };
	}

	private keepUsedCollections(collections: RoomCollection[], items: RoomArrangementItem[]): RoomCollection[] {
		const usedCollectionIds = new Set(items.map((item) => item.collectionId).filter((id) => !!id));
		const seenCollectionIds = new Set<string>();

		const usedCollections = collections.filter((collection) => {
			const keep = usedCollectionIds.has(collection.id) && !seenCollectionIds.has(collection.id);
			seenCollectionIds.add(collection.id);
			return keep;
		});

		return usedCollections.map(({ id, title }) => {
			return { id, title };
		});
	}

	private buildItem(id: EntityId, collectionId?: string): RoomArrangementItem {
		return collectionId ? { id, collectionId } : { id };
	}
}
