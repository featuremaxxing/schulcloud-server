import { EntityManager } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { BoardCompletionEntity, type BoardCompletionSource } from './entity';

@Injectable()
export class BoardCompletionRepo {
	constructor(private readonly em: EntityManager) {}

	public async findByBoardIds(boardIds: EntityId[], userIds?: EntityId[]): Promise<BoardCompletionEntity[]> {
		if (boardIds.length === 0) return [];

		return await this.em.find(BoardCompletionEntity, {
			boardId: { $in: boardIds },
			...(userIds ? { userId: { $in: userIds } } : {}),
		});
	}

	public async findOne(userId: EntityId, boardId: EntityId): Promise<BoardCompletionEntity | null> {
		return await this.em.findOne(BoardCompletionEntity, { userId, boardId });
	}

	// idempotent: an existing completion keeps its date and source
	public async markCompleted(userId: EntityId, boardId: EntityId, source: BoardCompletionSource): Promise<void> {
		const existing = await this.findOne(userId, boardId);
		if (existing) return;

		this.em.persist(new BoardCompletionEntity({ userId, boardId, completedAt: new Date(), source }));
		await this.em.flush();
	}

	public async deleteOne(userId: EntityId, boardId: EntityId): Promise<void> {
		await this.em.nativeDelete(BoardCompletionEntity, { userId, boardId });
	}

	public async deleteByBoardId(boardId: EntityId): Promise<void> {
		await this.em.nativeDelete(BoardCompletionEntity, { boardId });
	}

	public async deleteByUserId(userId: EntityId): Promise<number> {
		return await this.em.nativeDelete(BoardCompletionEntity, { userId });
	}
}
