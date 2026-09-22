import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class MovePinnedCardBodyParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the target column inside the learning room',
		pattern: bsonStringPattern,
	})
	toColumnId!: string;

	@IsOptional()
	@IsInt()
	@Min(0)
	@ApiPropertyOptional({ description: 'The position within the target column' })
	toPosition?: number;
}
