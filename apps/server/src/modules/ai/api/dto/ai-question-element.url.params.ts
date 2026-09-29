import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AiQuestionElementUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the AI question element.',
		required: true,
		nullable: false,
	})
	elementId!: string;
}
