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
	LearningPathCardStepListResponse,
	LearningPathCardStepPathResponse,
	LearningPathCardStepResponse,
	LearningPathCardUrlParams,
	LearningPathEnrollmentBodyParams,
	LearningPathLockResponse,
	LearningPathOverviewPathResponse,
	LearningPathOverviewProgressResponse,
	LearningPathOverviewResponse,
	LearningPathOverviewStudentResponse,
	LearningPathResponse,
	LearningPathRoomUrlParams,
	LearningPathStepResponse,
	LearningPathStepUrlParams,
	ResetLearningPathProgressBodyParams,
	UpdateLearningPathBodyParams,
	UpdateLearningPathStepBodyParams,
} from './dto';

const toStepResponse = (view: LearningPathStepView): LearningPathStepResponse =>
	new LearningPathStepResponse({
		id: view.step.id,
		linkedBoardId: view.step.linkedBoardId,
		linkedCardId: view.step.linkedCardId,
		title: view.title,
		boardTitle: view.boardTitle,
		isText: view.step.isText || undefined,
		text: view.text,
		isVisible: view.isVisible,
		positionX: view.step.positionX,
		positionY: view.step.positionY,
		prerequisiteStepIds: view.step.prerequisiteStepIds,
		unlockMode: view.step.unlockMode,
		lockUntilPrerequisitesDone: view.step.lockUntilPrerequisitesDone,
		status: view.status,
		reopened: view.reopened,
		lock: view.lock ? new LearningPathLockResponse(view.lock) : undefined,
		doneCount: view.doneCount,
		studentCount: view.studentCount,
	});

// a changed step is only seen by editors, the path is reloaded for the full view
const toChangedStepResponse = (step: LearningPathStep): LearningPathStepResponse =>
	toStepResponse({
		step,
		title: step.isText ? step.title : '',
		text: step.isText ? step.text : undefined,
		isVisible: true,
		status: 'open',
	});

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
			title: view.board.title,
			isEditor: view.isEditor,
			color: view.color,
			isEnrolled: view.isEnrolled,
			canChoose: view.canChoose,
			studentCount: view.studentCount,
			completedStudentCount: view.completedStudentCount,
			steps: view.steps.map(toStepResponse),
			availableBoards: view.availableBoards.map(
				(board) =>
					new LearningPathAvailableBoardResponse({ id: board.id, title: board.title, isVisible: board.isVisible })
			),
		});
	}

	@ApiOperation({ summary: 'Change the color of a learning path.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Patch('boards/:boardId/learning-path')
	public async updateLearningPath(
		@Param() urlParams: LearningPathBoardUrlParams,
		@Body() bodyParams: UpdateLearningPathBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningPathUc.updateColor(currentUser.userId, urlParams.boardId, bodyParams.color);
	}

	@ApiOperation({ summary: 'Go a learning path. Editors can enroll members of the room as well.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Put('boards/:boardId/enrollment')
	public async enroll(
		@Param() urlParams: LearningPathBoardUrlParams,
		@Body() bodyParams: LearningPathEnrollmentBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningPathUc.enroll(currentUser.userId, urlParams.boardId, bodyParams.userId);
	}

	@ApiOperation({ summary: 'Stop going a learning path. Editors can remove members of the room as well.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Delete('boards/:boardId/enrollment')
	public async unenroll(
		@Param() urlParams: LearningPathBoardUrlParams,
		@Body() bodyParams: LearningPathEnrollmentBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningPathUc.unenroll(currentUser.userId, urlParams.boardId, bodyParams.userId);
	}

	@ApiOperation({ summary: 'Who goes which learning path of a room, and how far they are. Editors only.' })
	@ApiResponse({ status: 200, type: LearningPathOverviewResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get('rooms/:roomId/learning-paths/overview')
	public async getOverview(
		@Param() urlParams: LearningPathRoomUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<LearningPathOverviewResponse> {
		const overview = await this.learningPathUc.getOverview(currentUser.userId, urlParams.roomId);

		return new LearningPathOverviewResponse({
			paths: overview.paths.map((path) => new LearningPathOverviewPathResponse(path)),
			students: overview.students.map(
				(student) =>
					new LearningPathOverviewStudentResponse({
						...student,
						paths: student.paths.map((progress) => new LearningPathOverviewProgressResponse(progress)),
					})
			),
		});
	}

	@ApiOperation({
		summary:
			'Start over for students of a room (default: all): stored completions and checkbox ticks are removed, submissions, poll votes and chosen learning paths stay. Editors only.',
	})
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Post('rooms/:roomId/learning-paths/reset')
	public async resetProgress(
		@Param() urlParams: LearningPathRoomUrlParams,
		@Body() bodyParams: ResetLearningPathProgressBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningPathUc.resetProgress(
			currentUser.userId,
			urlParams.roomId,
			bodyParams.userIds,
			bodyParams.pathId
		);
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
		const { boardId, linkedBoardId, positionX, positionY } = bodyParams;
		const step = linkedBoardId
			? await this.learningPathUc.createStep(
					currentUser.userId,
					boardId,
					linkedBoardId,
					positionX,
					positionY,
					bodyParams.linkedCardId
				)
			: await this.learningPathUc.createTextStep(
					currentUser.userId,
					boardId,
					bodyParams.title ?? '',
					bodyParams.text ?? '',
					positionX,
					positionY
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

	@ApiOperation({ summary: 'Whether the current user completed a card that is a step of a learning path.' })
	@ApiResponse({ status: 200, type: BoardCompletionResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get('cards/:cardId/completion')
	public async getCardCompletion(
		@Param() urlParams: LearningPathCardUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<BoardCompletionResponse> {
		const view = await this.learningPathUc.getCardCompletion(currentUser.userId, urlParams.cardId);

		return toCompletionResponse(view);
	}

	@ApiOperation({ summary: 'Mark a card without progress items as done, or undo it.' })
	@ApiResponse({ status: 200, type: BoardCompletionResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Put('cards/:cardId/completion')
	public async setCardCompletion(
		@Param() urlParams: LearningPathCardUrlParams,
		@Body() bodyParams: BoardCompletionBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<BoardCompletionResponse> {
		const view = await this.learningPathUc.setCardCompletion(
			currentUser.userId,
			urlParams.cardId,
			bodyParams.completed
		);

		return toCompletionResponse(view);
	}

	@ApiOperation({ summary: 'The cards of a board that are steps of a learning path, with their learning paths.' })
	@ApiResponse({ status: 200, type: LearningPathCardStepListResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get('boards/:boardId/learning-path-cards')
	public async getBoardCardSteps(
		@Param() urlParams: LearningPathBoardUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<LearningPathCardStepListResponse> {
		const steps = await this.learningPathUc.getBoardCardSteps(currentUser.userId, urlParams.boardId);

		return new LearningPathCardStepListResponse({
			data: Array.from(steps.entries()).map(
				([cardId, paths]) =>
					new LearningPathCardStepResponse({
						cardId,
						paths: paths.map((path) => new LearningPathCardStepPathResponse(path)),
					})
			),
		});
	}
}
