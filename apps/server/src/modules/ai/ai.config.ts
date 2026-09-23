import { ConfigProperty, Configuration } from '@infra/configuration';
import { StringToBoolean, StringToNumber } from '@shared/controller/transformer';
import { IsBoolean, IsInt, IsString, IsUrl, Min } from 'class-validator';

export const AI_CONFIG_TOKEN = 'AI_CONFIG_TOKEN';

// Feature switch and provider settings for the AI module (KI-Fragen). The flag is also
// exposed publicly so clients can hide the element type. Provider settings come from
// AI_CLIENT__*; the API key is deliberately excluded from public runtime configuration.
@Configuration()
export class AiConfig {
	@ConfigProperty('FEATURE_AI_ENABLED')
	@StringToBoolean()
	@IsBoolean()
	public featureAiEnabled = false;

	// key of the AI provider (z.ai); empty means "not configured" - the module treats
	// flag-without-key as disabled so a half-finished setup cannot start AI calls
	@ConfigProperty('AI_CLIENT__API_KEY')
	@IsString()
	public aiClientApiKey = '';

	// OpenAI-compatible chat-completions endpoint of the provider; not a secret
	@ConfigProperty('AI_CLIENT__BASE_URL')
	@IsUrl({ require_tld: false, require_valid_protocol: false })
	public aiClientBaseUrl = 'https://api.z.ai/api/coding/paas/v4';

	@ConfigProperty('AI_CLIENT__MODEL')
	@IsString()
	public aiClientModel = 'glm-4.6';

	@ConfigProperty('AI_CLIENT__TIMEOUT_MS')
	@StringToNumber()
	@IsInt()
	@Min(1)
	public aiClientTimeoutMs = 120_000;

	public isConfigured(): boolean {
		return this.featureAiEnabled && this.aiClientApiKey !== '';
	}
}
