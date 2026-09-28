import { TimeoutConfig } from '@core/interceptor';
import { ConfigProperty, Configuration } from '@infra/configuration';
import { StringToBoolean, StringToNumber } from '@shared/controller/transformer';
import { IsBoolean, IsNumber, IsUrl } from 'class-validator';

export const WEBDAV_CONFIG_TOKEN = 'WEBDAV_CONFIG_TOKEN';
export const WEBDAV_TIMEOUT_CONFIG_TOKEN = 'WEBDAV_TIMEOUT_CONFIG_TOKEN';
export const WEBDAV_INCOMING_REQUEST_TIMEOUT_KEY = 'webDavIncomingRequestTimeout';

@Configuration()
export class WebDavConfig {
	@ConfigProperty('FEATURE_WEBDAV_ENABLED')
	@StringToBoolean()
	@IsBoolean()
	public featureWebDavEnabled = false;

	@ConfigProperty('FILES_STORAGE__SERVICE_BASE_URL')
	@IsUrl({ require_tld: false })
	public filesStorageBaseUrl!: string;

	// lifetime of the JWT the server mints to talk to the file storage on the user's behalf
	@ConfigProperty('WEBDAV_FILES_STORAGE_JWT_LIFETIME_SECONDS')
	@StringToNumber()
	@IsNumber()
	public filesStorageJwtLifetimeSeconds = 900;
}

// Uploads and downloads of large files through a WebDAV drive take much longer than the
// default API timeout of a few seconds.
@Configuration()
export class WebDavTimeoutConfig extends TimeoutConfig {
	@ConfigProperty('WEBDAV_INCOMING_REQUEST_TIMEOUT')
	@IsNumber()
	@StringToNumber()
	public [WEBDAV_INCOMING_REQUEST_TIMEOUT_KEY] = 30 * 60_000;
}
