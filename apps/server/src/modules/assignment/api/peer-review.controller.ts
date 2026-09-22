import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import {
	Body,
	ConflictException,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Patch,
	Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { PeerReviewUc } from './peer-review.uc';
import {
	AssignmentElementUrlParams,
	PeerReviewAssignBodyParams,
	PeerReviewAssignmentResponse,
	PeerReviewAssignResultResponse,
	PeerReviewSettingsBodyParams,
	PeerReviewSettingsResponse,
	PeerReviewSubmitBodyParams,
	PeerReviewTaskResponse,
	PeerReviewTaskUrlParams,
	PeerReviewUnassignUrlParams,
} from './dto';
import { PeerReviewResponseMapper } from './mapper';

@ApiTags('Assignment')
@JwtAuthentication()
@Controller('assignments')
export class PeerReviewController {
	constructor(private readonly peerReviewUc: PeerReviewUc) {}

	@ApiOperation({ summary: 'Enable/disable peer review for an assignment and configure its mode/reviewer count.' })
	@ApiResponse({ status: 200, type: PeerReviewSettingsResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@HttpCode(200)
	@Patch(':elementId/peer-review-settings')
	public async updateSettings(
		@Param() urlParams: AssignmentElementUrlParams,
		@Body() bodyParams: PeerReviewSettingsBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<PeerReviewSettingsResponse> {
		const element = await this.peerReviewUc.updateSettings(currentUser.userId, urlParams.elementId, bodyParams);

		return PeerReviewResponseMapper.mapSettings(element);
	}

	@ApiOperation({
		summary:
			'Auto-assign peer reviewers: a cycle-free rotation so nobody reviews their own submission. Replaces every previous assignment for this element.',
	})
	@ApiResponse({ status: 200, type: PeerReviewAssignResultResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 409, description: 'Fewer than two submissions exist to assign reviewers between.' })
	@HttpCode(200)
	@Post(':elementId/peer-review/auto-assign')
	public async autoAssign(
		@Param() urlParams: AssignmentElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<PeerReviewAssignResultResponse> {
		const result = await this.peerReviewUc.autoAssign(currentUser.userId, urlParams.elementId);

		return new PeerReviewAssignResultResponse(result);
	}

	@ApiOperation({ summary: 'Manually assign specific reviewers to specific submissions.' })
	@ApiResponse({ status: 200, type: PeerReviewAssignResultResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({
		status: 422,
		description: 'An assignment pair is invalid (unknown submission, non-member, self-review).',
	})
	@HttpCode(200)
	@Post(':elementId/peer-review/assign')
	public async manualAssign(
		@Param() urlParams: AssignmentElementUrlParams,
		@Body() bodyParams: PeerReviewAssignBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<PeerReviewAssignResultResponse> {
		const result = await this.peerReviewUc.manualAssign(
			currentUser.userId,
			urlParams.elementId,
			bodyParams.assignments
		);

		return new PeerReviewAssignResultResponse(result);
	}

	@ApiOperation({
		summary: 'List every current reviewer<->submission pairing for an assignment, with reviewer identities.',
	})
	@ApiResponse({ status: 200, type: [PeerReviewAssignmentResponse] })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Get(':elementId/peer-review/assignments')
	public async listAssignments(
		@Param() urlParams: AssignmentElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<PeerReviewAssignmentResponse[]> {
		const results = await this.peerReviewUc.listAssignments(currentUser.userId, urlParams.elementId);

		return results.map((result) => PeerReviewResponseMapper.mapAssignment(result));
	}

	@ApiOperation({ summary: 'Remove one reviewer<->submission pairing, as long as it has not been submitted yet.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@ApiResponse({ status: 409, type: ConflictException })
	@HttpCode(204)
	@Delete(':elementId/peer-review/assignments/:submissionId/:reviewerUserId')
	public async unassign(
		@Param() urlParams: PeerReviewUnassignUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.peerReviewUc.unassign(
			currentUser.userId,
			urlParams.elementId,
			urlParams.submissionId,
			urlParams.reviewerUserId
		);
	}

	@ApiOperation({
		summary:
			'List the caller’s own peer review tasks. Anonymized: never reveals who submitted the work being reviewed.',
	})
	@ApiResponse({ status: 200, type: [PeerReviewTaskResponse] })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Get('peer-review/my-tasks')
	public async myTasks(@CurrentUser() currentUser: ICurrentUser): Promise<PeerReviewTaskResponse[]> {
		const results = await this.peerReviewUc.listMyTasks(currentUser.userId);

		return results.map((result) => PeerReviewResponseMapper.mapTask(result));
	}

	@ApiOperation({ summary: 'Submit (or update) the caller’s own review for an assigned peer review task.' })
	@ApiResponse({ status: 200, type: PeerReviewTaskResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(200)
	@Patch('peer-review/:reviewId/submit')
	public async submitReview(
		@Param() urlParams: PeerReviewTaskUrlParams,
		@Body() bodyParams: PeerReviewSubmitBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<PeerReviewTaskResponse> {
		const review = await this.peerReviewUc.submitReview(currentUser.userId, urlParams.reviewId, bodyParams);

		return PeerReviewResponseMapper.mapTask({ review });
	}
}
