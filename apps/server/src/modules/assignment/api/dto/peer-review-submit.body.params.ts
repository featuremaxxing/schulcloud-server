import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class PeerReviewSubmitBodyParams {
	@IsInt()
	@Min(0)
	@IsOptional()
	@ApiPropertyOptional()
	points?: number;

	@IsString()
	@IsOptional()
	@ApiPropertyOptional()
	feedbackComment?: string;
}
