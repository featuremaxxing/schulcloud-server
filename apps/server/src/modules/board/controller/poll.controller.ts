import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { PollUc } from '../uc';
import {
	PollAnswerResponse,
	PollElementUrlParams,
	PollQuestionResultResponse,
	PollResultsResponse,
	PollVoterResponse,
} from './dto';

// Lives inside the board module (not a sibling module like modules/assignment) because
// the live-vote socket handler needs this use case, and a sibling module that itself
// depends on board-node.service would create a `board -> poll -> board` import cycle.
@ApiTags('Poll')
@JwtAuthentication()
@Controller('polls')
export class PollController {
	constructor(private readonly pollUc: PollUc) {}

	@ApiOperation({ summary: 'Get the results of a poll element.' })
	@ApiResponse({ status: 200, type: PollResultsResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get(':elementId/results')
	public async getResults(
		@Param() urlParams: PollElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<PollResultsResponse> {
		const result = await this.pollUc.getResults(currentUser.userId, urlParams.elementId);

		const response = new PollResultsResponse({
			totalVotes: result.totalVotes,
			participantCount: result.participantCount,
			myVote: result.myVote?.map((answer) => new PollAnswerResponse(answer)),
			results: result.results?.map(
				(question) =>
					new PollQuestionResultResponse({
						questionId: question.questionId,
						counts: question.counts,
						textAnswers: question.textAnswers,
					})
			),
			voters: result.voters?.map(
				(voter) =>
					new PollVoterResponse({
						userId: voter.userId,
						firstName: voter.firstName,
						lastName: voter.lastName,
						answers: voter.answers.map((answer) => new PollAnswerResponse(answer)),
					})
			),
		});

		return response;
	}
}
