import { LegacyLogger } from '@infra/logger';
import { SOCKETIO_ADAPTER_COLLECTION_NAME } from '@infra/socketio';
import { EntityManager } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { Emitter } from '@socket.io/mongo-emitter';
import { EntityId } from '@shared/domain/types';

export const LEARNING_PATH_CHANGED_EVENT = 'learning-path-changed';

export interface LearningPathChangedPayload {
	boardId: EntityId;
}

/**
 * Tells everyone who has a learning path open that its steps or arrows changed, the same way
 * as FileAreaNotifier. Clients reload the path, so the payload carries nothing but the board.
 */
@Injectable()
export class LearningPathNotifier {
	private emitter: Emitter | undefined;

	constructor(
		private readonly em: EntityManager,
		private readonly logger: LegacyLogger
	) {}

	public changed(boardId: EntityId): void {
		const payload: LearningPathChangedPayload = { boardId };
		try {
			this.getEmitter().to(`board_${boardId}`).emit(LEARNING_PATH_CHANGED_EVENT, payload);
		} catch (error) {
			// a missed live update must never fail the change that was already saved
			this.logger.warn(
				`could not notify learning path ${boardId}: ${(error as Error).message}`,
				LearningPathNotifier.name
			);
		}
	}

	private getEmitter(): Emitter {
		if (!this.emitter) {
			const collection = this.em.getConnection().getCollection(SOCKETIO_ADAPTER_COLLECTION_NAME);
			this.emitter = new Emitter(collection, '/', { addCreatedAtField: true });
		}

		return this.emitter;
	}
}
