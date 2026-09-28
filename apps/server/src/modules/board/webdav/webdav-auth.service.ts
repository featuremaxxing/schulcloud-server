import { AppPasswordService, canUseAppPasswords } from '@modules/app-password';
import { AuthenticationService } from '@modules/authentication';
import { AuthorizationService } from '@modules/authorization';
import { type User } from '@modules/user/repo';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { WEBDAV_CONFIG_TOKEN, WebDavConfig } from './webdav.config';
import { WebDavError } from './webdav.error';

export interface WebDavPrincipal {
	user: User;
	getFilesStorageJwt: () => Promise<string>;
}

interface CachedJwt {
	jwt: string;
	expiresAt: number;
}

// renew the file storage JWT well before it runs out, a download may take a while
const JWT_RENEWAL_MARGIN_MS = 5 * 60_000;
const JWT_CACHE_MAX_ENTRIES = 10_000;

@Injectable()
export class WebDavAuthService {
	private readonly jwtCache = new Map<EntityId, CachedJwt>();

	constructor(
		private readonly appPasswordService: AppPasswordService,
		private readonly authenticationService: AuthenticationService,
		@Inject(forwardRef(() => AuthorizationService))
		private readonly authorizationService: AuthorizationService,
		@Inject(WEBDAV_CONFIG_TOKEN) private readonly config: WebDavConfig
	) {}

	/**
	 * Resolves the user behind an "Authorization: Basic ..." header. The username is not
	 * checked - clients need one, but the app password alone identifies its owner.
	 * Throws a 403 WebDavError for users who may not use the drive (see canUseAppPasswords).
	 */
	public async authenticate(authorizationHeader: string | undefined): Promise<WebDavPrincipal | null> {
		const token = WebDavAuthService.extractBasicPassword(authorizationHeader);
		if (!token) {
			return null;
		}

		const verified = await this.appPasswordService.verify(token);
		if (!verified) {
			return null;
		}

		let user: User;
		try {
			user = await this.authorizationService.getUserWithPermissions(verified.userId);
		} catch {
			// the owner has been deleted in the meantime
			return null;
		}

		if (!canUseAppPasswords(user.getRoles().map((role) => role.name))) {
			throw WebDavError.forbidden('The network drive is only available to teachers');
		}

		return { user, getFilesStorageJwt: () => this.getFilesStorageJwt(user) };
	}

	private async getFilesStorageJwt(user: User): Promise<string> {
		const cached = this.jwtCache.get(user.id);
		if (cached && cached.expiresAt - JWT_RENEWAL_MARGIN_MS > Date.now()) {
			return cached.jwt;
		}

		const lifetimeSeconds = this.config.filesStorageJwtLifetimeSeconds;
		const jwt = await this.authenticationService.generateJwtForUser(user, lifetimeSeconds);

		if (this.jwtCache.size >= JWT_CACHE_MAX_ENTRIES) {
			const [oldestKey] = this.jwtCache.keys();
			if (oldestKey) {
				this.jwtCache.delete(oldestKey);
			}
		}
		this.jwtCache.delete(user.id);
		this.jwtCache.set(user.id, { jwt, expiresAt: Date.now() + lifetimeSeconds * 1000 });

		return jwt;
	}

	private static extractBasicPassword(authorizationHeader: string | undefined): string | null {
		const match = authorizationHeader?.match(/^Basic\s+(.+)$/i);
		if (!match) {
			return null;
		}

		const decoded = Buffer.from(match[1].trim(), 'base64').toString('utf8');
		const separatorIndex = decoded.indexOf(':');
		if (separatorIndex < 0) {
			return null;
		}

		const password = decoded.slice(separatorIndex + 1).trim();

		return password || null;
	}
}
