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
	Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { LearningPathStep } from '../domain';
import { BoardCompletionView, LearningPathStepView, LearningPathUc } from '../uc';
import {
	BoardCompletionBodyParams,
	BoardCompletionResponse,
	CreateLearningPathStepBodyParams,
	LearningPathAvailableBoardResponse,
	LearningPathBoardUrlParams,
	LearningPathResponse,
	LearningPathStepResponse,
	LearningPathStepUrlParams,
	UpdateLearningPathStepBodyParams,
} from './dto';

const toStepResponse = (view: LearningPathStepView): LearningPathStepResponse =>
	new LearningPathStepResponse({
		id: view.step.id,
		linkedBoardId: view.step.linkedBoardId,
		title: view.title,
		isVisible: view.isVisible,
		positionX: view.step.positionX,
		positionY: view.step.positionY,
		prerequisiteStepIds: view.step.prerequisiteStepIds,
		unlockMode: view.step.unlockMode,
		lockUntilPrerequisitesDone: view.step.lockUntilPrerequisitesDone,
		status: view.status,
		doneCount: view.doneCount,
		studentCount: view.studentCount,
	});

// a changed step is only seen by editors, the path is reloaded for the full view
const toChangedStepResponse = (step: LearningPathStep): LearningPathStepResponse =>
	toStepResponse({ step, title: '', isVisible: true, status: 'open' });

const toCompletionResponse = (view: BoardCompletionView): BoardCompletionResponse => new BoardCompletionResponse(view);

@ApiTags('Board Learning Path')
@JwtAuthentication()
@Controller()
export class LearningPathController {
	constructor(private readonly learningPathUc: LearningPathUc) {}

	@ApiOperation({ summary: 'Get a learning path with the state of every step for the current user.' })
	@ApiResponse({ status: 200, type: LearningPathResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get('boards/:boardId/learning-path')
	public async getLearningPath(
		@Param() urlParams: LearningPathBoardUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<LearningPathResponse> {
		const view = await this.learningPathUc.getLearningPath(currentUser.userId, urlParams.boardId);

		return new LearningPathResponse({
			boardId: view.board.id,
			isEditor: view.isEditor,
			steps: view.steps.map(toStepResponse),
			availableBoards: view.availableBoards.map(
				(board) => new LearningPathAvailableBoardResponse({ id: board.id, title: board.title, isVisible: board.isVisible })
			),
		});
	}

	@ApiOperation({ summary: 'Add a board of the same room to a learning path.' })
	@ApiResponse({ status: 201, type: LearningPathStepResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Post('learning-path-steps')
	public async createStep(
		@Body() bodyParams: CreateLearningPathStepBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<LearningPathStepResponse> {
		const step = await this.learningPathUc.createStep(
			currentUser.userId,
			bodyParams.boardId,
			bodyParams.linkedBoardId,
			bodyParams.positionX,
			bodyParams.positionY
		);

		return toChangedStepResponse(step);
	}

	@ApiOperation({ summary: 'Move a step, change its arrows or its unlock settings.' })
	@ApiResponse({ status: 200, type: LearningPathStepResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Patch('learning-path-steps/:stepId')
	public async updateStep(
		@Param() urlParams: LearningPathStepUrlParams,
		@Body() bodyParams: UpdateLearningPathStepBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<LearningPathStepResponse> {
		const step = await this.learningPathUc.updateStep(currentUser.userId, urlParams.stepId, bodyParams);

		return toChangedStepResponse(step);
	}

	@ApiOperation({ summary: 'Remove a board from a learning path, together with its arrows.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Delete('learning-path-steps/:stepId')
	public async deleteStep(
		@Param() urlParams: LearningPathStepUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningPathUc.deleteStep(currentUser.userId, urlParams.stepId);
	}

	@ApiOperation({ summary: 'Whether the current user completed a board of a learning path.' })
	@ApiResponse({ status: 200, type: BoardCompletionResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get('boards/:boardId/completion')
	public async getCompletion(
		@Param() urlParams: LearningPathBoardUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<BoardCompletionResponse> {
		const view = await this.learningPathUc.getCompletion(currentUser.userId, urlParams.boardId);

		return toCompletionResponse(view);
	}

	@ApiOperation({ summary: 'Mark a board without progress items as done, or undo it.' })
	@ApiResponse({ status: 200, type: BoardCompletionResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Put('boards/:boardId/completion')
	public async setCompletion(
		@Param() urlParams: LearningPathBoardUrlParams,
		@Body() bodyParams: BoardCompletionBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<BoardCompletionResponse> {
		const view = await this.learningPathUc.setCompletion(currentUser.userId, urlParams.boardId, bodyParams.completed);

		return toCompletionResponse(view);
	}
}
