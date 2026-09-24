import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsMongoId } from 'class-validator';

export class CheckboxElementParams {
	@IsMongoId()
	@ApiProperty()
	public elementId!: string;
}
export class CheckboxApprovalParams extends CheckboxElementParams {
	@IsMongoId()
	@ApiProperty()
	public userId!: string;
}
export class CheckboxCheckBody {
	@IsBoolean()
	@ApiProperty()
	public checked!: boolean;
}
export class CheckboxApproveBody {
	@IsBoolean()
	@ApiProperty()
	public approved!: boolean;
}
export class CheckboxStudentState {
	@ApiProperty()
	public checked!: boolean;
	@ApiProperty()
	public approved!: boolean;
}
export class CheckboxStudentEntry extends CheckboxStudentState {
	@ApiProperty()
	public userId!: string;
	@ApiPropertyOptional()
	public firstName?: string;
	@ApiPropertyOptional()
	public lastName?: string;
}
export class CheckboxStateResponse {
	@ApiPropertyOptional({ type: [CheckboxStudentEntry] })
	@Type(() => CheckboxStudentEntry)
	public entries?: CheckboxStudentEntry[];
	@ApiPropertyOptional({ type: CheckboxStudentState, description: 'Only returned to eligible students.' })
	public myEntry?: CheckboxStudentState;
	@ApiProperty()
	public canManage!: boolean;
	@ApiProperty()
	public hasCheckActivity!: boolean;
}
