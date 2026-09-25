import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StringToBoolean } from '@shared/controller/transformer';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export enum ProgressElementType {
	CHECKBOX = 'checkbox',
	ASSIGNMENT = 'assignment',
	POLL = 'poll',
}

export class ProgressQueryParams {
	@IsOptional()
	@StringToBoolean()
	@IsBoolean()
	@ApiPropertyOptional({
		description: 'When true and the caller manages the board, include the per-student breakdown.',
	})
	public details?: boolean;
}

export class ProgressSummaryResponse {
	@ApiProperty()
	public done!: number;

	@ApiProperty()
	public total!: number;
}

export class ProgressStudentEntry {
	@ApiProperty()
	public userId!: string;

	@ApiPropertyOptional()
	public firstName?: string;

	@ApiPropertyOptional()
	public lastName?: string;

	@ApiProperty()
	public done!: boolean;
}

export class ProgressItemResponse {
	@ApiProperty({ enum: ProgressElementType })
	public type!: ProgressElementType;

	@ApiProperty()
	public elementId!: string;

	@ApiProperty()
	public cardId!: string;

	@ApiPropertyOptional()
	public cardTitle?: string;

	@ApiProperty()
	public title!: string;

	@ApiPropertyOptional()
	public dueDate?: Date;

	// The requesting user's own eligibility/completion - meaningful for the student view.
	@ApiProperty()
	public eligible!: boolean;

	@ApiProperty()
	public done!: boolean;

	@ApiProperty()
	public doneCount!: number;

	@ApiProperty()
	public eligibleCount!: number;

	@ApiPropertyOptional({ type: [ProgressStudentEntry], description: 'Only present for a manager with ?details=true.' })
	@Type(() => ProgressStudentEntry)
	public students?: ProgressStudentEntry[];
}

export class BoardProgressResponse {
	@ApiProperty()
	public boardId!: string;

	@ApiProperty()
	public boardTitle!: string;

	@ApiProperty()
	public isTeacherView!: boolean;

	@ApiProperty({ type: ProgressSummaryResponse })
	@Type(() => ProgressSummaryResponse)
	public summary!: ProgressSummaryResponse;

	@ApiProperty({ type: [ProgressItemResponse] })
	@Type(() => ProgressItemResponse)
	public items!: ProgressItemResponse[];
}

export class RoomProgressResponse {
	@ApiProperty()
	public roomId!: string;

	@ApiProperty({ type: ProgressSummaryResponse })
	@Type(() => ProgressSummaryResponse)
	public summary!: ProgressSummaryResponse;

	@ApiProperty({ type: [BoardProgressResponse] })
	@Type(() => BoardProgressResponse)
	public boards!: BoardProgressResponse[];
}
