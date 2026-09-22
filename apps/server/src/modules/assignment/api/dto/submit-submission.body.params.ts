import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// The submitting student's optional note, sent along with a (re)submit. The
// teacher's separate answer lives in GradeSubmissionBodyParams.feedbackComment.
export class SubmitSubmissionBodyParams {
	@IsOptional()
	@IsString()
	@MaxLength(10000)
	@ApiPropertyOptional({ description: 'optional note from the submitting student' })
	comment?: string;
}
