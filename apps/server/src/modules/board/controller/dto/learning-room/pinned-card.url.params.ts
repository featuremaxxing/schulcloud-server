import { ApiProperty } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { IsMongoId } from 'class-validator';

export class PinnedCardUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the pinned card pointer node',
		pattern: bsonStringPattern,
		required: true,
		nullable: false,
	})
	pinnedCardId!: string;
}

export class PinnedCardByCardUrlParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the referenced card',
		pattern: bsonStringPattern,
		required: true,
		nullable: false,
	})
	cardId!: string;
}
