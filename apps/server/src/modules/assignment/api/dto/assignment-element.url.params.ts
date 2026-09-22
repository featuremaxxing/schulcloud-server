import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AssignmentElementUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the assignment element.',
		required: true,
		nullable: false,
	})
	elementId!: string;
}
