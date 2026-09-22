import { ApiProperty } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { IsMongoId } from 'class-validator';

export class PinCardBodyParams {
	@IsMongoId()
	@ApiProperty({
		description: 'The id of the card to pin into the personal learning room',
		pattern: bsonStringPattern,
	})
	cardId!: string;
}
