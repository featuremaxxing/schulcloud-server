import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WebDavLockInfo } from './webdav-xml';

const DEFAULT_TIMEOUT_SECONDS = 3600;
const MAX_TIMEOUT_SECONDS = 3600;

/**
 * Finder and Windows Explorer refuse to write to a WebDAV share that does not support
 * LOCK (class 2). The board has no notion of file locks, and several people editing
 * via the web UI would not respect them anyway, so locks are granted but not enforced.
 * They only live in memory to answer refreshes with the same token.
 */
@Injectable()
export class WebDavLockStore {
	private readonly locks = new Map<string, WebDavLockInfo & { expiresAt: number }>();

	public create(href: string, owner: string | undefined, requestedTimeout: string | undefined): WebDavLockInfo {
		this.removeExpired();

		const timeoutSeconds = WebDavLockStore.parseTimeout(requestedTimeout);
		const lock = {
			token: `opaquelocktoken:${randomUUID()}`,
			href,
			owner,
			timeoutSeconds,
			depth: '0' as const,
			expiresAt: Date.now() + timeoutSeconds * 1000,
		};
		this.locks.set(lock.token, lock);

		return lock;
	}

	public refresh(token: string, requestedTimeout: string | undefined): WebDavLockInfo | undefined {
		const lock = this.locks.get(token);
		if (!lock) {
			return undefined;
		}

		lock.timeoutSeconds = WebDavLockStore.parseTimeout(requestedTimeout);
		lock.expiresAt = Date.now() + lock.timeoutSeconds * 1000;

		return lock;
	}

	public remove(token: string): void {
		this.locks.delete(token);
	}

	private removeExpired(): void {
		const now = Date.now();
		for (const [token, lock] of this.locks) {
			if (lock.expiresAt < now) {
				this.locks.delete(token);
			}
		}
	}

	// "Second-600", "Infinite" or a comma separated list of both
	private static parseTimeout(requestedTimeout: string | undefined): number {
		const match = requestedTimeout?.match(/Second-(\d+)/i);
		const seconds = match ? Number.parseInt(match[1], 10) : DEFAULT_TIMEOUT_SECONDS;

		return Math.min(Math.max(seconds, 1), MAX_TIMEOUT_SECONDS);
	}
}
