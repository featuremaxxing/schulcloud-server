import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class PeerReviewUnassignUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the assignment element.',
		required: true,
		nullable: false,
	})
	elementId!: string;

	@IsMongoId()
	@ApiProperty({
		description: 'The id of the submission.',
		required: true,
		nullable: false,
	})
	submissionId!: string;

	@IsMongoId()
	@ApiProperty({
		description: 'The id of the reviewer whose assignment to this submission should be removed.',
		required: true,
		nullable: false,
	})
	reviewerUserId!: string;
}
