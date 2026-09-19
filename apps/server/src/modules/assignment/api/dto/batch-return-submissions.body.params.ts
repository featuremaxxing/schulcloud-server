import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsMongoId } from 'class-validator';

export class BatchReturnSubmissionsBodyParams {
	@ApiProperty({
		description: 'The IDs of the submissions to return. Only submissions that already carry a grade are returned.',
		type: [String],
	})
	@IsArray()
	@ArrayNotEmpty()
	@IsMongoId({ each: true })
	submissionIds!: string[];
}
