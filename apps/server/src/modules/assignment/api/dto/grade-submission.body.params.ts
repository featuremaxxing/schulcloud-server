import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

// Used for both the "grade" (draft) and "return" endpoints. Both fields stay optional so a
// teacher can save a comment without points yet, or vice versa. The upper bound (maxPoints)
// depends on the assignment and is validated in the use case, not here.
export class GradeSubmissionBodyParams {
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
