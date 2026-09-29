import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	HttpStatus,
	NotFoundException,
	Param,
	Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { AppPasswordEntity } from '../repo';
import { AppPasswordUc } from './app-password.uc';
import {
	AppPasswordListResponse,
	AppPasswordResponse,
	AppPasswordUrlParams,
	CreateAppPasswordBodyParams,
	CreatedAppPasswordResponse,
} from './dto';

@ApiTags('AppPassword')
@JwtAuthentication()
@Controller('app-passwords')
export class AppPasswordController {
	constructor(private readonly appPasswordUc: AppPasswordUc) {}

	@ApiOperation({ summary: 'List the app passwords of the current user (without secrets).' })
	@ApiResponse({ status: 200, type: AppPasswordListResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Get()
	public async getAppPasswords(@CurrentUser() currentUser: ICurrentUser): Promise<AppPasswordListResponse> {
		const appPasswords = await this.appPasswordUc.getAppPasswords(currentUser.userId);

		return new AppPasswordListResponse(appPasswords.map((appPassword) => this.mapToResponse(appPassword)));
	}

	@ApiOperation({ summary: 'Create an app password. The secret is only returned in this response.' })
	@ApiResponse({ status: 201, type: CreatedAppPasswordResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@Post()
	public async createAppPassword(
		@CurrentUser() currentUser: ICurrentUser,
		@Body() bodyParams: CreateAppPasswordBodyParams
	): Promise<CreatedAppPasswordResponse> {
		const { appPassword, token, username } = await this.appPasswordUc.createAppPassword(
			currentUser.userId,
			bodyParams.name
		);

		return new CreatedAppPasswordResponse({ ...this.mapToResponse(appPassword), token, username });
	}

	@ApiOperation({ summary: 'Revoke an app password of the current user.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(HttpStatus.NO_CONTENT)
	@Delete(':appPasswordId')
	public async deleteAppPassword(
		@CurrentUser() currentUser: ICurrentUser,
		@Param() urlParams: AppPasswordUrlParams
	): Promise<void> {
		await this.appPasswordUc.deleteAppPassword(currentUser.userId, urlParams.appPasswordId);
	}

	private mapToResponse(appPassword: AppPasswordEntity): AppPasswordResponse {
		return new AppPasswordResponse({
			id: appPassword.id,
			name: appPassword.name,
			createdAt: appPassword.createdAt,
			lastUsedAt: appPassword.lastUsedAt,
		});
	}
}
