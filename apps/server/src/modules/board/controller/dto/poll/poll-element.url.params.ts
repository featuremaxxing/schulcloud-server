import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class PollElementUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the poll element.',
		required: true,
		nullable: false,
	})
	elementId!: string;
}
