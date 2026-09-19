import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsMongoId, ValidateNested } from 'class-validator';

export class PeerReviewAssignmentPairBodyParams {
	@IsMongoId()
	@ApiProperty()
	submissionId!: string;

	@IsMongoId()
	@ApiProperty()
	reviewerUserId!: string;
}

export class PeerReviewAssignBodyParams {
	@IsArray()
	@ArrayNotEmpty()
	@ValidateNested({ each: true })
	@Type(() => PeerReviewAssignmentPairBodyParams)
	@ApiProperty({ type: [PeerReviewAssignmentPairBodyParams] })
	assignments!: PeerReviewAssignmentPairBodyParams[];
}
