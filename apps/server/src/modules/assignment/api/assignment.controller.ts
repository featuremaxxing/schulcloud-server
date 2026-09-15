import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { AssignmentUc } from './assignment.uc';
import {
	AssignmentElementUrlParams,
	AssignmentListQueryParams,
	AssignmentListResponse,
	AssignmentSubmissionListResponse,
	AssignmentSubmissionResponse,
	AssignmentSubmissionUrlParams,
	GradeSubmissionBodyParams,
	SubmitSubmissionBodyParams,
} from './dto';
import { AssignmentListResponseMapper, AssignmentSubmissionResponseMapper } from './mapper';

@ApiTags('Assignment')
@JwtAuthentication()
@Controller('assignments')
export class AssignmentController {
	constructor(private readonly assignmentUc: AssignmentUc) {}

	@ApiOperation({
		summary:
			"List the assignment elements in the caller's rooms (teacher: submission counts, student: own submission status).",
	})
	@ApiResponse({ status: 200, type: AssignmentListResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Get()
	public async listAssignments(
		@Query() queryParams: AssignmentListQueryParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AssignmentListResponse> {
		const result = await this.assignmentUc.listAssignments(currentUser.userId, queryParams.roomId);

		return AssignmentListResponseMapper.mapList(result);
	}

	@ApiOperation({ summary: "List an assignment's submissions (teacher: all students, student: own only)." })
	@ApiResponse({ status: 200, type: AssignmentSubmissionListResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get(':elementId/submissions')
	public async listSubmissions(
		@Param() urlParams: AssignmentElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AssignmentSubmissionListResponse> {
		const result = await this.assignmentUc.listSubmissions(currentUser.userId, urlParams.elementId);

		return AssignmentSubmissionResponseMapper.mapList(result);
	}

	@ApiOperation({ summary: 'Create (or, if it exists, return) the caller’s own submission for an assignment.' })
	@ApiResponse({ status: 201, type: AssignmentSubmissionResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(201)
	@Post(':elementId/submissions')
	public async createOwnSubmission(
		@Param() urlParams: AssignmentElementUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AssignmentSubmissionResponse> {
		const result = await this.assignmentUc.createOwnSubmission(currentUser.userId, urlParams.elementId);

		return AssignmentSubmissionResponseMapper.mapSingleForOwner(result);
	}

	@ApiOperation({
		summary: 'Submit (or resubmit) the caller’s own submission. Requires a file to already be uploaded.',
	})
	@ApiResponse({ status: 200, type: AssignmentSubmissionResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@ApiResponse({ status: 409, description: 'No file has been uploaded to this submission yet.' })
	@HttpCode(200)
	@Patch('submissions/:submissionId/submit')
	public async submit(
		@Param() urlParams: AssignmentSubmissionUrlParams,
		@CurrentUser() currentUser: ICurrentUser,
		@Body() bodyParams?: SubmitSubmissionBodyParams
	): Promise<AssignmentSubmissionResponse> {
		const result = await this.assignmentUc.submit(currentUser.userId, urlParams.submissionId, bodyParams?.comment);

		return AssignmentSubmissionResponseMapper.mapSingleForOwner(result);
	}

	@ApiOperation({ summary: 'Withdraw the caller’s own submission, as long as it has not been returned yet.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Delete('submissions/:submissionId')
	public async deleteOwnSubmission(
		@Param() urlParams: AssignmentSubmissionUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.assignmentUc.deleteOwnSubmission(currentUser.userId, urlParams.submissionId);
	}

	@ApiOperation({
		summary: 'Save a draft grade (points/comment) for a submission, without returning it to the student.',
	})
	@ApiResponse({ status: 200, type: AssignmentSubmissionResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(200)
	@Patch('submissions/:submissionId/grade')
	public async gradeSubmission(
		@Param() urlParams: AssignmentSubmissionUrlParams,
		@Body() bodyParams: GradeSubmissionBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AssignmentSubmissionResponse> {
		const result = await this.assignmentUc.gradeSubmission(currentUser.userId, urlParams.submissionId, bodyParams);

		return AssignmentSubmissionResponseMapper.mapSingleForTeacher(result);
	}

	@ApiOperation({
		summary: 'Grade (optional) and return a submission - only then does the student see points/comment.',
	})
	@ApiResponse({ status: 200, type: AssignmentSubmissionResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(200)
	@Post('submissions/:submissionId/return')
	public async returnSubmission(
		@Param() urlParams: AssignmentSubmissionUrlParams,
		@Body() bodyParams: GradeSubmissionBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<AssignmentSubmissionResponse> {
		const result = await this.assignmentUc.returnSubmission(currentUser.userId, urlParams.submissionId, bodyParams);

		return AssignmentSubmissionResponseMapper.mapSingleForTeacher(result);
	}
}
