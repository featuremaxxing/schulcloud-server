import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class PeerReviewTaskUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the peer review task.',
		required: true,
		nullable: false,
	})
	reviewId!: string;
}
