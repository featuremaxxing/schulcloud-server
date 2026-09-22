import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { LearningRoomUc } from '../../uc';
import { BoardResponse } from '../dto';
import {
	MovePinnedCardBodyParams,
	PinCardBodyParams,
	PinnedCardByCardUrlParams,
	PinnedCardIdsResponse,
	PinnedCardUrlParams,
} from '../dto/learning-room';
import { BoardResponseMapper } from '../mapper';

@ApiTags('Learning Room')
@JwtAuthentication()
@Controller('learning-room')
export class LearningRoomController {
	constructor(private readonly learningRoomUc: LearningRoomUc) {}

	@ApiOperation({ summary: "Get the current user's personal learning room. Creates it on first access." })
	@ApiResponse({ status: 200, type: BoardResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Get()
	public async getLearningRoom(@CurrentUser() currentUser: ICurrentUser): Promise<BoardResponse> {
		const { board, features, allowedOperations, pinnedCardOrigins } = await this.learningRoomUc.getLearningRoom(
			currentUser.userId
		);

		const response = BoardResponseMapper.mapToResponse(board, features, allowedOperations, pinnedCardOrigins);

		return response;
	}

	@ApiOperation({ summary: 'Ids of the cards the current user has pinned.' })
	@ApiResponse({ status: 200, type: PinnedCardIdsResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Get('pinned-cards')
	public async getPinnedCardIds(@CurrentUser() currentUser: ICurrentUser): Promise<PinnedCardIdsResponse> {
		const cardIds = await this.learningRoomUc.getPinnedCardIds(currentUser.userId);

		return new PinnedCardIdsResponse(cardIds);
	}

	@ApiOperation({ summary: 'Pin a card into the personal learning room.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@HttpCode(204)
	@Post('pinned-cards')
	public async pinCard(@Body() bodyParams: PinCardBodyParams, @CurrentUser() currentUser: ICurrentUser): Promise<void> {
		await this.learningRoomUc.pinCard(currentUser.userId, bodyParams.cardId);
	}

	@ApiOperation({ summary: 'Remove a card from the personal learning room.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@HttpCode(204)
	@Delete('pinned-cards/:cardId')
	public async unpinCard(
		@Param() urlParams: PinnedCardByCardUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningRoomUc.unpinCard(currentUser.userId, urlParams.cardId);
	}

	@ApiOperation({ summary: 'Move a pinned card to another column or position inside the learning room.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@HttpCode(204)
	@Put('pinned-cards/:pinnedCardId/position')
	public async movePinnedCard(
		@Param() urlParams: PinnedCardUrlParams,
		@Body() bodyParams: MovePinnedCardBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.learningRoomUc.movePinnedCard(
			currentUser.userId,
			urlParams.pinnedCardId,
			bodyParams.toColumnId,
			bodyParams.toPosition
		);
	}
}
