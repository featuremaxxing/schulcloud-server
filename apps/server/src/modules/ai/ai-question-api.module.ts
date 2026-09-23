import { ConfigurationModule } from '@infra/configuration';
import { LoggerModule } from '@infra/logger';
import { AuthorizationModule } from '@modules/authorization';
import { BoardModule } from '@modules/board';
import { Module } from '@nestjs/common';
import { AI_CONFIG_TOKEN, AiConfig } from './ai.config';
import { AiClientService } from './ai-client.service';
import { AiQuestionController, AiQuestionUc } from './api';

// KI-Fragen: board element type + answer/assessment endpoints, backed by the
// AiClientService against an OpenAI-compatible provider. See ai.config.ts for the
// environment wiring (FEATURE_AI_ENABLED, AI_CLIENT__*).
@Module({
	imports: [ConfigurationModule.register(AI_CONFIG_TOKEN, AiConfig), AuthorizationModule, BoardModule, LoggerModule],
	controllers: [AiQuestionController],
	providers: [AiQuestionUc, AiClientService],
})
export class AiQuestionApiModule {}
