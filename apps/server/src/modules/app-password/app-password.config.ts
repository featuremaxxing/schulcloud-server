import { ConfigProperty, Configuration } from '@infra/configuration';
import { StringToBoolean } from '@shared/controller/transformer';
import { IsBoolean } from 'class-validator';

export const APP_PASSWORD_CONFIG_TOKEN = 'APP_PASSWORD_CONFIG_TOKEN';

// App passwords currently only exist for the WebDAV access to boards, so they share its
// feature flag (see modules/webdav/webdav.config.ts).
@Configuration()
export class AppPasswordConfig {
	@ConfigProperty('FEATURE_WEBDAV_ENABLED')
	@StringToBoolean()
	@IsBoolean()
	public featureWebDavEnabled = false;
}
