import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AppPasswordEntity, AppPasswordRepo } from '../repo';

export interface VerifiedAppPassword {
	appPasswordId: EntityId;
	userId: EntityId;
}

interface CacheEntry extends VerifiedAppPassword {
	expiresAt: number;
}

// WebDAV clients send the credentials with every single request (a folder listing in
// Finder easily means dozens of requests). bcrypt is deliberately slow, so successful
// verifications are cached for a short time. Revocation clears the local cache; other
// server instances pick it up once their entry expires.
const VERIFICATION_CACHE_TTL_MS = 60_000;
const VERIFICATION_CACHE_MAX_ENTRIES = 10_000;
// lastUsedAt is informational only - avoid a database write per request
const LAST_USED_UPDATE_INTERVAL_MS = 10 * 60_000;
const MAX_APP_PASSWORDS_PER_USER = 20;
const TOKEN_SEPARATOR = '.';

@Injectable()
export class AppPasswordService {
	private readonly verificationCache = new Map<string, CacheEntry>();

	constructor(private readonly appPasswordRepo: AppPasswordRepo) {}

	public findByUserId(userId: EntityId): Promise<AppPasswordEntity[]> {
		return this.appPasswordRepo.findByUserId(userId);
	}

	/**
	 * Creates a new app password. The returned token is the only place where the secret
	 * exists in plain text - it cannot be recovered later.
	 */
	public async create(userId: EntityId, name: string): Promise<{ appPassword: AppPasswordEntity; token: string }> {
		const count = await this.appPasswordRepo.countByUserId(userId);
		if (count >= MAX_APP_PASSWORDS_PER_USER) {
			throw new BadRequestException(`A user can have at most ${MAX_APP_PASSWORDS_PER_USER} app passwords`);
		}

		const secret = randomBytes(24).toString('base64url');
		const secretHash = await bcrypt.hash(secret, 10);
		const appPassword = await this.appPasswordRepo.create({ userId, name: name.trim(), secretHash });
		const token = `${appPassword.id}${TOKEN_SEPARATOR}${secret}`;

		return { appPassword, token };
	}

	public async delete(userId: EntityId, appPasswordId: EntityId): Promise<void> {
		const appPassword = await this.appPasswordRepo.findById(appPasswordId);
		if (!appPassword || appPassword.userId !== userId) {
			throw new NotFoundException();
		}

		await this.appPasswordRepo.delete(appPassword);
		this.evictFromCache((entry) => entry.appPasswordId === appPasswordId);
	}

	public async deleteAllByUserId(userId: EntityId): Promise<EntityId[]> {
		const deletedIds = await this.appPasswordRepo.deleteByUserId(userId);
		this.evictFromCache((entry) => entry.userId === userId);

		return deletedIds;
	}

	/**
	 * Returns the owner of the app password if the token is valid, otherwise null.
	 */
	public async verify(token: string): Promise<VerifiedAppPassword | null> {
		const cacheKey = createHash('sha256').update(token).digest('hex');
		const cached = this.verificationCache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			return { appPasswordId: cached.appPasswordId, userId: cached.userId };
		}
		this.verificationCache.delete(cacheKey);

		const separatorIndex = token.indexOf(TOKEN_SEPARATOR);
		if (separatorIndex <= 0) {
			return null;
		}
		const appPasswordId = token.slice(0, separatorIndex);
		const secret = token.slice(separatorIndex + 1);

		const appPassword = await this.appPasswordRepo.findById(appPasswordId);
		if (!appPassword) {
			return null;
		}

		const isValid = await bcrypt.compare(secret, appPassword.secretHash);
		if (!isValid) {
			return null;
		}

		await this.touch(appPassword);

		const verified = { appPasswordId: appPassword.id, userId: appPassword.userId };
		this.addToCache(cacheKey, verified);

		return verified;
	}

	private async touch(appPassword: AppPasswordEntity): Promise<void> {
		const now = new Date();
		const lastUsedAt = appPassword.lastUsedAt?.getTime() ?? 0;
		if (now.getTime() - lastUsedAt > LAST_USED_UPDATE_INTERVAL_MS) {
			await this.appPasswordRepo.updateLastUsedAt(appPassword.id, now);
		}
	}

	private addToCache(cacheKey: string, verified: VerifiedAppPassword): void {
		if (this.verificationCache.size >= VERIFICATION_CACHE_MAX_ENTRIES) {
			// Map keeps insertion order - drop the oldest entry
			const [oldestKey] = this.verificationCache.keys();
			if (oldestKey) {
				this.verificationCache.delete(oldestKey);
			}
		}
		this.verificationCache.set(cacheKey, { ...verified, expiresAt: Date.now() + VERIFICATION_CACHE_TTL_MS });
	}

	private evictFromCache(predicate: (entry: CacheEntry) => boolean): void {
		for (const [key, entry] of this.verificationCache) {
			if (predicate(entry)) {
				this.verificationCache.delete(key);
			}
		}
	}
}
