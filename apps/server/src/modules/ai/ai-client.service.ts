import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Logger } from '@infra/logger';
import { AI_CONFIG_TOKEN, AiConfig } from './ai.config';
import {
	AiRequestFailedLoggable,
	AiRequestRejectedLoggable,
	AiResponseWithoutContentLoggable,
} from './loggable/ai-client.loggable';

interface ChatCompletionMessage {
	role: 'system' | 'user';
	content: string;
}

interface ChatCompletionResponse {
	choices?: { message?: { content?: string } }[];
}

// Thin OpenAI-compatible chat-completions client (z.ai / GLM). Deliberately no SDK:
// one endpoint, one use case, easy to swap the provider by changing the config values.
@Injectable()
export class AiClientService {
	constructor(
		@Inject(AI_CONFIG_TOKEN) private readonly config: AiConfig,
		private readonly logger: Logger
	) {}

	// Sends one system prompt + one user prompt and returns the model's message content.
	// Low temperature: answers should be deterministic assessments, not creative writing.
	public async complete(systemPrompt: string, userPrompt: string): Promise<string> {
		if (!this.config.isConfigured()) {
			throw new ServiceUnavailableException('The AI feature is not configured.');
		}

		const body = {
			model: this.config.aiClientModel,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			] satisfies ChatCompletionMessage[],
			temperature: 0.2,
		};

		let response: Response;
		try {
			response = await fetch(`${this.config.aiClientBaseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.config.aiClientApiKey}`,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			this.logger.warning(new AiRequestFailedLoggable(error as Error));
			throw new ServiceUnavailableException('The AI service is currently unavailable.');
		}

		if (!response.ok) {
			this.logger.warning(new AiRequestRejectedLoggable(response.status));
			throw new ServiceUnavailableException('The AI service is currently unavailable.');
		}

		const data = (await response.json()) as ChatCompletionResponse;
		const content = data.choices?.[0]?.message?.content;
		if (typeof content !== 'string' || content.trim() === '') {
			this.logger.warning(new AiResponseWithoutContentLoggable());
			throw new ServiceUnavailableException('The AI service returned no answer.');
		}

		return content.trim();
	}
}
