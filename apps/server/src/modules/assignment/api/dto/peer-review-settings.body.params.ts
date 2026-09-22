import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class PeerReviewSettingsBodyParams {
	@IsBoolean()
	@ApiProperty()
	enabled!: boolean;

	@IsIn(['manual', 'auto'])
	@IsOptional()
	@ApiPropertyOptional({ enum: ['manual', 'auto'] })
	mode?: 'manual' | 'auto';

	@IsInt()
	@Min(1)
	@IsOptional()
	@ApiPropertyOptional({ description: 'how many reviewers each submission gets, only used for auto-assign' })
	count?: number;
}
