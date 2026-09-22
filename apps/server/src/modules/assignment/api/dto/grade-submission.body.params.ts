import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CriterionPointsBodyParams {
	@IsString()
	@ApiPropertyOptional()
	criterionId!: string;

	@IsInt()
	@Min(0)
	@ApiPropertyOptional()
	points!: number;
}

// Used for both the "grade" (draft) and "return" endpoints. All fields stay optional so a
// teacher can save a comment without points yet, or vice versa. The upper bound (maxPoints)
// depends on the assignment and is validated in the use case, not here. `criterionPoints` is
// required by the use case instead of here when the assignment has a rubric - this DTO alone
// cannot know that.
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

	@IsArray()
	@ArrayMaxSize(50)
	@ValidateNested({ each: true })
	@Type(() => CriterionPointsBodyParams)
	@IsOptional()
	@ApiPropertyOptional({ type: [CriterionPointsBodyParams] })
	criterionPoints?: CriterionPointsBodyParams[];
}
