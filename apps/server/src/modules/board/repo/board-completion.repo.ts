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

	// idempotent: an existing completion keeps its date and source. For a card, boardId is the
	// card's id and cardBoardId the board it lies on.
	public async markCompleted(
		userId: EntityId,
		boardId: EntityId,
		source: BoardCompletionSource,
		cardBoardId?: EntityId
	): Promise<void> {
		const existing = await this.findOne(userId, boardId);
		if (existing) return;

		this.em.persist(new BoardCompletionEntity({ userId, boardId, cardBoardId, completedAt: new Date(), source }));
		await this.em.flush();
	}

	public async deleteOne(userId: EntityId, boardId: EntityId): Promise<void> {
		await this.em.nativeDelete(BoardCompletionEntity, { userId, boardId });
	}

	public async deleteByBoardIdsAndUserIds(boardIds: EntityId[], userIds: EntityId[]): Promise<void> {
		if (boardIds.length === 0 || userIds.length === 0) return;

		await this.em.nativeDelete(BoardCompletionEntity, {
			$or: [{ boardId: { $in: boardIds } }, { cardBoardId: { $in: boardIds } }],
			userId: { $in: userIds },
		});
	}

	// exactly the given boards and cards, not the cards of the boards
	public async deleteByTargetIdsAndUserIds(targetIds: EntityId[], userIds: EntityId[]): Promise<void> {
		if (targetIds.length === 0 || userIds.length === 0) return;

		await this.em.nativeDelete(BoardCompletionEntity, { boardId: { $in: targetIds }, userId: { $in: userIds } });
	}

	// the board's own completions and those of its cards
	public async deleteByBoardId(boardId: EntityId): Promise<void> {
		await this.em.nativeDelete(BoardCompletionEntity, { $or: [{ boardId }, { cardBoardId: boardId }] });
	}

	public async deleteByCardId(cardId: EntityId): Promise<void> {
		await this.em.nativeDelete(BoardCompletionEntity, { boardId: cardId });
	}

	// a card moved to another board
	public async updateCardBoard(cardId: EntityId, cardBoardId: EntityId): Promise<void> {
		const completions = await this.em.find(BoardCompletionEntity, { boardId: cardId });
		completions.forEach((completion) => {
			completion.cardBoardId = cardBoardId;
		});
		await this.em.flush();
	}

	public async deleteByUserId(userId: EntityId): Promise<number> {
		return await this.em.nativeDelete(BoardCompletionEntity, { userId });
	}
}
