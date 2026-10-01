import { EntityManager } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { LearningPathEnrollmentEntity } from './entity';

@Injectable()
export class LearningPathEnrollmentRepo {
	constructor(private readonly em: EntityManager) {}

	public async findByPathBoardIds(pathBoardIds: EntityId[]): Promise<LearningPathEnrollmentEntity[]> {
		if (pathBoardIds.length === 0) return [];

		return await this.em.find(LearningPathEnrollmentEntity, { pathBoardId: { $in: pathBoardIds } });
	}

	public async findByUserInRoom(userId: EntityId, roomId: EntityId): Promise<LearningPathEnrollmentEntity[]> {
		return await this.em.find(LearningPathEnrollmentEntity, { userId, roomId });
	}

	public async findByRoom(roomId: EntityId): Promise<LearningPathEnrollmentEntity[]> {
		return await this.em.find(LearningPathEnrollmentEntity, { roomId });
	}

	// idempotent
	public async enroll(userId: EntityId, pathBoardId: EntityId, roomId: EntityId): Promise<void> {
		const existing = await this.em.findOne(LearningPathEnrollmentEntity, { userId, pathBoardId });
		if (existing) return;

		this.em.persist(new LearningPathEnrollmentEntity({ userId, pathBoardId, roomId }));
		await this.em.flush();
	}

	public async unenroll(userId: EntityId, pathBoardId: EntityId): Promise<void> {
		await this.em.nativeDelete(LearningPathEnrollmentEntity, { userId, pathBoardId });
	}

	public async deleteByPathBoardId(pathBoardId: EntityId): Promise<void> {
		await this.em.nativeDelete(LearningPathEnrollmentEntity, { pathBoardId });
	}

	public async deleteByUserId(userId: EntityId): Promise<number> {
		return await this.em.nativeDelete(LearningPathEnrollmentEntity, { userId });
	}
}
