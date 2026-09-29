import { LegacyLogger } from '@infra/logger';
import { SOCKETIO_ADAPTER_COLLECTION_NAME } from '@infra/socketio';
import { EntityManager } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { Emitter } from '@socket.io/mongo-emitter';
import { EntityId } from '@shared/domain/types';

export const FILE_AREA_CHANGED_EVENT = 'file-area-changed';

export interface FileAreaChangedPayload {
	boardId: EntityId;
	// the folders (or the board itself) whose content changed
	parentIds: EntityId[];
	// folders: subfolders were added, renamed, moved or removed; files: files of these parents changed
	kind: 'folders' | 'files';
}

/**
 * Tells everyone who has a file area open that a level of it changed.
 *
 * Changes arrive through the REST API and the WebDAV drive, which run in another process than
 * the board collaboration sockets. Both share the socket.io adapter collection in MongoDB, so
 * the message is written there and every collaboration instance forwards it to the sockets in
 * the room of the board. The payload only names the changed levels; clients reload them, so
 * nothing about the content leaks to sockets that lost their permissions in the meantime.
 */
@Injectable()
export class FileAreaNotifier {
	private emitter: Emitter | undefined;

	constructor(
		private readonly em: EntityManager,
		private readonly logger: LegacyLogger
	) {}

	public foldersChanged(boardId: EntityId, parentIds: EntityId[]): void {
		this.notify({ boardId, parentIds: Array.from(new Set(parentIds)), kind: 'folders' });
	}

	public filesChanged(boardId: EntityId, parentIds: EntityId[]): void {
		this.notify({ boardId, parentIds: Array.from(new Set(parentIds)), kind: 'files' });
	}

	private notify(payload: FileAreaChangedPayload): void {
		try {
			this.getEmitter().to(`board_${payload.boardId}`).emit(FILE_AREA_CHANGED_EVENT, payload);
		} catch (error) {
			// a missed live update must never fail the change that was already saved
			this.logger.warn(
				`could not notify file area ${payload.boardId}: ${(error as Error).message}`,
				FileAreaNotifier.name
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
