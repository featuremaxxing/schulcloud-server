import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';

export interface WebDavVirtualFile {
	content: Buffer;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: number;
}

// AppleDouble files ("._Foto.jpg") are a few KB; anything bigger is not metadata
export const MAX_VIRTUAL_FILE_BYTES = 1024 * 1024;
const SYSTEM_FILE_TTL_MS = 12 * 60 * 60_000;
const PLACEHOLDER_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 20_000;

/**
 * Files the drive has to pretend to have, without storing them in a board:
 *
 * - System files like "._Foto.jpg" or ".DS_Store". macOS writes them next to every copied
 *   file and reads them back right away - if they are missing, Finder aborts the copy
 *   (error -8058). They must never clutter the board, so they only live here.
 * - Placeholders for files that were LOCKed before their first PUT (RFC 4918 7.3: locking
 *   an unmapped URL creates an empty resource). The real file replaces them on PUT.
 *
 * Kept in memory per user and path, with a time limit - losing them only means Finder
 * rewrites its metadata.
 */
@Injectable()
export class WebDavVirtualFileStore {
	private readonly files = new Map<string, WebDavVirtualFile>();

	public get(userId: EntityId, segments: string[]): WebDavVirtualFile | undefined {
		const key = WebDavVirtualFileStore.key(userId, segments);
		const file = this.files.get(key);
		if (file && file.expiresAt < Date.now()) {
			this.files.delete(key);
			return undefined;
		}

		return file;
	}

	public set(userId: EntityId, segments: string[], content: Buffer, placeholder = false): boolean {
		this.removeExpired();

		const key = WebDavVirtualFileStore.key(userId, segments);
		const existing = this.files.get(key);
		const now = new Date();
		const created = !existing;
		this.files.delete(key);
		this.files.set(key, {
			content,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			expiresAt: now.getTime() + (placeholder ? PLACEHOLDER_TTL_MS : SYSTEM_FILE_TTL_MS),
		});

		return created;
	}

	public delete(userId: EntityId, segments: string[]): boolean {
		return this.files.delete(WebDavVirtualFileStore.key(userId, segments));
	}

	public copy(userId: EntityId, from: string[], to: string[], move: boolean): boolean {
		const file = this.get(userId, from);
		if (!file) {
			return false;
		}
		this.set(userId, to, file.content);
		if (move) {
			this.delete(userId, from);
		}

		return true;
	}

	private removeExpired(): void {
		const now = Date.now();
		for (const [key, file] of this.files) {
			if (file.expiresAt < now) {
				this.files.delete(key);
			}
		}
		while (this.files.size >= MAX_ENTRIES) {
			const [oldestKey] = this.files.keys();
			this.files.delete(oldestKey);
		}
	}

	// case-insensitive like the rest of the drive
	private static key(userId: EntityId, segments: string[]): string {
		return `${userId}\n${segments.join('/').toLowerCase()}`;
	}
}
