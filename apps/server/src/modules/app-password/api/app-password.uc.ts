import { UserService } from '@modules/user';
import { Inject, Injectable } from '@nestjs/common';
import { FeatureDisabledLoggableException } from '@shared/common/loggable-exception';
import { EntityId } from '@shared/domain/types';
import { APP_PASSWORD_CONFIG_TOKEN, AppPasswordConfig } from '../app-password.config';
import { AppPasswordService } from '../domain';
import { AppPasswordEntity } from '../repo';

@Injectable()
export class AppPasswordUc {
	constructor(
		private readonly appPasswordService: AppPasswordService,
		private readonly userService: UserService,
		@Inject(APP_PASSWORD_CONFIG_TOKEN) private readonly config: AppPasswordConfig
	) {}

	public async getAppPasswords(userId: EntityId): Promise<AppPasswordEntity[]> {
		this.checkFeatureEnabled();

		const appPasswords = await this.appPasswordService.findByUserId(userId);

		return appPasswords;
	}

	public async createAppPassword(
		userId: EntityId,
		name: string
	): Promise<{ appPassword: AppPasswordEntity; token: string; username: string }> {
		this.checkFeatureEnabled();

		const [created, user] = await Promise.all([
			this.appPasswordService.create(userId, name),
			this.userService.findById(userId),
		]);

		// The username is not checked on login (the token identifies the user), but clients
		// require one - the e-mail address is what users recognize.
		return { ...created, username: user.email };
	}

	public async deleteAppPassword(userId: EntityId, appPasswordId: EntityId): Promise<void> {
		this.checkFeatureEnabled();

		await this.appPasswordService.delete(userId, appPasswordId);
	}

	private checkFeatureEnabled(): void {
		if (!this.config.featureWebDavEnabled) {
			throw new FeatureDisabledLoggableException('FEATURE_WEBDAV_ENABLED');
		}
	}
}
