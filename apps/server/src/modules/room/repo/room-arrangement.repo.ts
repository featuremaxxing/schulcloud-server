import { EntityManager } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { RoomArrangement, RoomArrangementItem, RoomCollection } from '../domain';
import { RoomArrangementEntity } from './entity';

@Injectable()
export class RoomArrangementRepo {
	constructor(private readonly em: EntityManager) {}

	public async findItemsByUserId(userId: EntityId): Promise<RoomArrangementItem[]> {
		const roomArrangement = await this.em.findOneOrFail(RoomArrangementEntity, { userId });

		return roomArrangement.items;
	}

	public async findArrangementByUserId(userId: EntityId): Promise<RoomArrangement> {
		const roomArrangement = await this.em.findOneOrFail(RoomArrangementEntity, { userId });

		return { items: roomArrangement.items, collections: roomArrangement.collections ?? [] };
	}

	public async hasArrangementForUserId(userId: EntityId): Promise<boolean> {
		const count = await this.em.count(RoomArrangementEntity, { userId });
		return count > 0;
	}

	public async createArrangement(userId: EntityId, items: RoomArrangementItem[]): Promise<void> {
		this.em.create(RoomArrangementEntity, { userId, items });
		await this.em.flush();
	}

	public async updateArrangement(
		userId: EntityId,
		items: RoomArrangementItem[],
		collections?: RoomCollection[]
	): Promise<void> {
		this.em.clear();
		const roomArrangement = await this.em.findOneOrFail(RoomArrangementEntity, { userId });
		roomArrangement.items = items;
		if (collections) {
			roomArrangement.collections = collections;
		}
		this.em.persist(roomArrangement);
		await this.em.flush();
	}

	public async deleteArrangements(userId: EntityId): Promise<EntityId[]> {
		const roomArrangements = await this.em.find(RoomArrangementEntity, { userId });

		this.em.remove(roomArrangements);
		await this.em.flush();

		const deletedIds = roomArrangements.map((arrangement) => arrangement.id);

		return deletedIds;
	}
}
