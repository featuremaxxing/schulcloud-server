import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { AiQuestionUc } from './ai-question.uc';
import {
	AiQuestionAnswerResponse,
	AiQuestionAnswersListResponse,
	AiQuestionAnswerTeacherResponse,
	AiQuestionConfigResponse,
	AiQuestionOwnAnswerResponse,
	AiQuestionElementUrlParams,
	CreateAiQuestionAnswerBodyParams,
} from './dto';

@ApiTags('AiQuestion')
@JwtAuthentication()
@Controller('ai-questions')
export class AiQuestionController {
	constructor(private readonly aiQuestionUc: AiQuestionUc) {}

	@ApiOperation({ summary: 'Read the private teacher config (instructions, expected answer) of an AI question.' })
	@ApiResponse({ status: 200, type: AiQuestionConfigResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get(':elementId/config')
	public getConfig(
		@Param() urlParams: AiQuestionElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AiQuestionConfigResponse> {
		return this.aiQuestionUc.getConfig(currentUser.userId, urlParams.elementId);
	}

	@ApiOperation({
		summary:
			'Submit (or, when the element allows multiple attempts, replace) the caller\u2019s answer and get the AI\u2019s assessment.',
	})
	@ApiResponse({ status: 200, type: AiQuestionAnswerResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@ApiResponse({ status: 503, description: 'The AI service is unavailable or not configured.' })
	@HttpCode(200)
	@Post(':elementId/answer')
	public async submitAnswer(
		@Param() urlParams: AiQuestionElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser,
		@Body() bodyParams: CreateAiQuestionAnswerBodyParams
	): Promise<AiQuestionAnswerResponse> {
		const answer = await this.aiQuestionUc.submitAnswer(currentUser.userId, urlParams.elementId, bodyParams.answer);

		return new AiQuestionAnswerResponse({
			id: answer.id,
			userId: answer.userId,
			answer: answer.answer ?? '',
			aiResponse: answer.aiResponse ?? '',
			answeredAt: (answer.answeredAt ?? new Date(0)).toISOString(),
			attemptCount: answer.attemptCount,
		});
	}

	@ApiOperation({ summary: 'Read the caller\u2019s own answer for an AI question (null when not answered yet).' })
	@ApiResponse({ status: 200, type: AiQuestionOwnAnswerResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get(':elementId/answer')
	public getOwnAnswer(
		@Param() urlParams: AiQuestionElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AiQuestionOwnAnswerResponse> {
		return this.aiQuestionUc.getOwnAnswer(currentUser.userId, urlParams.elementId);
	}

	@ApiOperation({ summary: 'List all answers given on an AI question (teachers only).' })
	@ApiResponse({ status: 200, type: AiQuestionAnswersListResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get(':elementId/answers')
	public async listAnswers(
		@Param() urlParams: AiQuestionElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AiQuestionAnswersListResponse> {
		const result = await this.aiQuestionUc.listAnswers(currentUser.userId, urlParams.elementId);

		return new AiQuestionAnswersListResponse({
			answers: result.answers.map(
				({ answer, firstName, lastName }) =>
					new AiQuestionAnswerTeacherResponse({
						id: answer.id,
						userId: answer.userId,
						answer: answer.answer ?? '',
						aiResponse: answer.aiResponse ?? '',
						answeredAt: (answer.answeredAt ?? new Date(0)).toISOString(),
						attemptCount: answer.attemptCount,
						firstName,
						lastName,
					})
			),
		});
	}
}
