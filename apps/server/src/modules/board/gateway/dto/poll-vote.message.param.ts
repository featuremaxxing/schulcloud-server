import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsMongoId, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class PollVoteAnswerMessageParam {
	// Not a Mongo id lookup - matched against PollQuestion/PollOption ids embedded in the
	// poll element (see update-element-content.body.params.ts PollQuestionBody/PollOptionBody).
	@IsString()
	@MaxLength(64)
	@ApiProperty()
	questionId!: string;

	@IsArray()
	@ArrayMaxSize(10)
	@IsString({ each: true })
	@MaxLength(64, { each: true })
	@ApiProperty({ type: [String] })
	selectedOptionIds!: string[];

	@IsString()
	@IsOptional()
	@MaxLength(2000)
	@ApiPropertyOptional()
	textAnswer?: string;
}

export class PollVoteMessageParams {
	@IsMongoId()
	elementId!: string;

	@IsArray()
	@ArrayMaxSize(20)
	@ValidateNested({ each: true })
	@Type(() => PollVoteAnswerMessageParam)
	@ApiProperty({ type: () => [PollVoteAnswerMessageParam] })
	answers!: PollVoteAnswerMessageParam[];
}
