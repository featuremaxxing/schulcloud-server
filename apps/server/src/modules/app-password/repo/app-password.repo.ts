import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { AppPasswordEntity } from './entity';

@Injectable()
export class AppPasswordRepo {
	constructor(private readonly em: EntityManager) {}

	public async findByUserId(userId: EntityId): Promise<AppPasswordEntity[]> {
		const appPasswords = await this.em.find(AppPasswordEntity, { userId }, { orderBy: { createdAt: 'asc' } });

		return appPasswords;
	}

	public async countByUserId(userId: EntityId): Promise<number> {
		const count = await this.em.count(AppPasswordEntity, { userId });

		return count;
	}

	public async findById(id: EntityId): Promise<AppPasswordEntity | null> {
		if (!ObjectId.isValid(id)) {
			return null;
		}

		const appPassword = await this.em.findOne(AppPasswordEntity, { id });

		return appPassword;
	}

	public async create(props: { userId: EntityId; name: string; secretHash: string }): Promise<AppPasswordEntity> {
		const appPassword = this.em.create(AppPasswordEntity, props);
		await this.em.flush();

		return appPassword;
	}

	public async updateLastUsedAt(id: EntityId, lastUsedAt: Date): Promise<void> {
		await this.em.nativeUpdate(AppPasswordEntity, { id }, { lastUsedAt });
	}

	public async delete(appPassword: AppPasswordEntity): Promise<void> {
		await this.em.remove(appPassword).flush();
	}

	public async deleteByUserId(userId: EntityId): Promise<EntityId[]> {
		const appPasswords = await this.em.find(AppPasswordEntity, { userId });

		this.em.remove(appPasswords);
		await this.em.flush();

		return appPasswords.map((appPassword) => appPassword.id);
	}
}
