import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';

export class CardSkeletonResponse {
	constructor({ cardId, height, pinnedCardId }: CardSkeletonResponse) {
		this.cardId = cardId;
		this.height = height;
		this.pinnedCardId = pinnedCardId;
	}

	@ApiProperty({
		pattern: bsonStringPattern,
	})
	cardId: string;

	@ApiProperty({
		description:
			'The approximate height of the referenced card. Intended to be used for prerendering purposes. Note, that different devices can lead to this value not being precise',
	})
	height: number;

	@ApiPropertyOptional({
		pattern: bsonStringPattern,
		description:
			'Set when this entry is a pinned reference inside a personal learning room. Holds the id of the pointer node - the card itself lives in its original board and is loaded through the regular card api. Use this id to move or unpin the entry.',
	})
	pinnedCardId?: string;
}
