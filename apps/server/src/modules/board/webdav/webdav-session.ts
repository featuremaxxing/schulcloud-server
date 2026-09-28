import { type EntityId } from '@shared/domain/types';
import { type ColumnBoard } from '../domain';
import { type WebDavPrincipal } from './webdav-auth.service';
import { type WebDavFileRecord } from './webdav-files-storage.client';
import { type WebDavContext } from './webdav-resource';

/**
 * Per-request state: the authenticated user and memoized lookups, so resolving a deep
 * path and listing its children does not load the same board or file list twice.
 */
export class WebDavSession {
	public readonly contexts = new Map<string, Promise<WebDavContext[]>>();

	public readonly boardsOfContext = new Map<EntityId, Promise<ColumnBoard[]>>();

	public readonly boardTrees = new Map<EntityId, Promise<ColumnBoard>>();

	public readonly files = new Map<EntityId, Promise<WebDavFileRecord[]>>();

	constructor(public readonly principal: WebDavPrincipal) {}

	get userId(): EntityId {
		return this.principal.user.id;
	}

	public memoize<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
		let pending = cache.get(key);
		if (!pending) {
			pending = load();
			cache.set(key, pending);
		}

		return pending;
	}

	// drop memoized data after a write, so a follow-up lookup in the same request is fresh
	public forgetBoard(boardId: EntityId): void {
		this.boardTrees.delete(boardId);
	}

	public forgetFiles(elementId: EntityId): void {
		this.files.delete(elementId);
	}
}
