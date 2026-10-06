import { ObjectId } from '@mikro-orm/mongodb';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { RoomArrangementRepo } from '../../repo';
import { RoomArrangement, RoomArrangementItem, RoomTag } from '../type';

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
				tags: [],
			};
		}

		const arrangement = await this.sortAndUpdateArrangement(userId, availableRoomIds);

		return arrangement;
	}

	/**
	 * Replaces the personal tags of a room. Tags are matched by name, ignoring case;
	 * unknown names become new tags and tags no room uses anymore are removed.
	 */
	public async setRoomTags(userId: EntityId, roomId: EntityId, names: string[]): Promise<RoomArrangement> {
		const { items, tags } = await this.roomArrangementRepo.findArrangementByUserId(userId);
		const item = items.find((i) => i.id === roomId);
		if (!item) {
			throw new BadRequestException(`Room with ID ${roomId} not found in arrangement of user '${userId}'`);
		}

		const newTags = [...tags];
		const tagIds: EntityId[] = [];
		for (const name of this.uniqueTagNames(names)) {
			let tag = newTags.find((t) => this.isSameTagName(t.name, name));
			if (!tag) {
				tag = { id: new ObjectId().toHexString(), name };
				newTags.push(tag);
			}
			tagIds.push(tag.id);
		}

		const newItems = items.map((i) =>
			i.id === roomId ? this.buildItem(i.id, tagIds) : this.buildItem(i.id, i.tagIds)
		);
		const arrangement = this.withoutUnusedTags(newItems, newTags);

		await this.roomArrangementRepo.updateArrangement(userId, arrangement.items, arrangement.tags);

		return arrangement;
	}

	/** Renaming a tag to the name of another tag merges both. */
	public async renameTag(userId: EntityId, tagId: EntityId, name: string): Promise<void> {
		const { items, tags } = await this.roomArrangementRepo.findArrangementByUserId(userId);
		const [newName] = this.uniqueTagNames([name]);
		if (!tags.some((tag) => tag.id === tagId)) {
			throw new NotFoundException(`Tag with ID ${tagId} not found in arrangement of user '${userId}'`);
		}
		if (!newName) {
			throw new BadRequestException('The name of a tag must not be empty');
		}

		const sameNameTag = tags.find((tag) => tag.id !== tagId && this.isSameTagName(tag.name, newName));
		if (!sameNameTag) {
			const renamedTags = tags.map((tag) => (tag.id === tagId ? { id: tag.id, name: newName } : tag));
			await this.roomArrangementRepo.updateArrangement(userId, items, renamedTags);
			return;
		}

		const mergedItems = items.map((item) =>
			this.buildItem(
				item.id,
				item.tagIds?.map((id) => (id === tagId ? sameNameTag.id : id))
			)
		);
		const arrangement = this.withoutUnusedTags(mergedItems, tags);
		await this.roomArrangementRepo.updateArrangement(userId, arrangement.items, arrangement.tags);
	}

	public async deleteTag(userId: EntityId, tagId: EntityId): Promise<void> {
		const { items, tags } = await this.roomArrangementRepo.findArrangementByUserId(userId);
		if (!tags.some((tag) => tag.id === tagId)) {
			throw new NotFoundException(`Tag with ID ${tagId} not found in arrangement of user '${userId}'`);
		}

		const newItems = items.map((item) =>
			this.buildItem(
				item.id,
				item.tagIds?.filter((id) => id !== tagId)
			)
		);
		const arrangement = this.withoutUnusedTags(newItems, tags);
		await this.roomArrangementRepo.updateArrangement(userId, arrangement.items, arrangement.tags);
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
		const { items, tags } = await this.roomArrangementRepo.findArrangementByUserId(userId);
		const roomIds = items.map((item) => item.id);
		const tagIdsByRoomId = new Map(items.map((item) => [item.id, item.tagIds]));

		const knownRoomIds = availableRoomIds
			.filter((roomId) => tagIdsByRoomId.has(roomId))
			.sort((a, b) => roomIds.indexOf(a) - roomIds.indexOf(b));
		const unknownRoomIds = availableRoomIds.filter((roomId) => !tagIdsByRoomId.has(roomId));

		const sortedItems = [
			...knownRoomIds.map((roomId) => this.buildItem(roomId, tagIdsByRoomId.get(roomId))),
			...unknownRoomIds.map((roomId) => this.buildItem(roomId)),
		];
		const arrangement = this.withoutUnusedTags(sortedItems, tags);

		await this.roomArrangementRepo.updateArrangement(userId, arrangement.items, arrangement.tags);

		return arrangement;
	}

	/** Drops tags no room uses and references to tags that do not exist. */
	private withoutUnusedTags(items: RoomArrangementItem[], tags: RoomTag[]): RoomArrangement {
		const knownTagIds = new Set(tags.map((tag) => tag.id));
		const cleanedItems = items.map((item) =>
			this.buildItem(
				item.id,
				item.tagIds?.filter((id) => knownTagIds.has(id))
			)
		);
		const usedTagIds = new Set(cleanedItems.flatMap((item) => item.tagIds ?? []));
		const usedTags = tags
			.filter((tag) => usedTagIds.has(tag.id))
			.map(({ id, name }) => {
				return { id, name };
			});

		return { items: cleanedItems, tags: usedTags };
	}

	private buildItem(id: EntityId, tagIds?: EntityId[] | null): RoomArrangementItem {
		const uniqueTagIds = [...new Set(tagIds ?? [])];

		return uniqueTagIds.length > 0 ? { id, tagIds: uniqueTagIds } : { id };
	}

	private uniqueTagNames(names: string[]): string[] {
		const result: string[] = [];
		for (const name of names) {
			const normalized = name.replace(/\s+/g, ' ').trim();
			if (normalized && !result.some((n) => this.isSameTagName(n, normalized))) {
				result.push(normalized);
			}
		}

		return result;
	}

	private isSameTagName(a: string, b: string): boolean {
		return a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0;
	}
}
