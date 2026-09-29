import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CheckboxUc } from '../uc/checkbox.uc';
import {
	CheckboxApprovalParams,
	CheckboxApproveBody,
	CheckboxCheckBody,
	CheckboxElementParams,
	CheckboxStateResponse,
} from './dto/checkbox';

@ApiTags('Board Checkbox')
@JwtAuthentication()
@Controller('checkbox')
export class CheckboxController {
	constructor(private readonly checkboxUc: CheckboxUc) {}
	@Get(':elementId')
	public get(
		@Param() params: CheckboxElementParams,
		@CurrentUser() user: ICurrentUser
	): Promise<CheckboxStateResponse> {
		return this.checkboxUc.get(user.userId, params.elementId);
	}
	@Put(':elementId/check')
	public check(
		@Param() params: CheckboxElementParams,
		@Body() body: CheckboxCheckBody,
		@CurrentUser() user: ICurrentUser
	): Promise<CheckboxStateResponse> {
		return this.checkboxUc.check(user.userId, params.elementId, body.checked);
	}
	@Put(':elementId/approve/:userId')
	public approve(
		@Param() params: CheckboxApprovalParams,
		@Body() body: CheckboxApproveBody,
		@CurrentUser() user: ICurrentUser
	): Promise<CheckboxStateResponse> {
		return this.checkboxUc.approve(user.userId, params.elementId, params.userId, body.approved);
	}
}
