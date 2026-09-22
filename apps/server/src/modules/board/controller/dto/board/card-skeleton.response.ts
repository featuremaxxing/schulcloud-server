import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';

export class CardSkeletonResponse {
	constructor({ cardId, height, pinnedCardId, originBoardId, originTitle }: CardSkeletonResponse) {
		this.cardId = cardId;
		this.height = height;
		this.pinnedCardId = pinnedCardId;
		this.originBoardId = originBoardId;
		this.originTitle = originTitle;
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

	@ApiPropertyOptional({
		pattern: bsonStringPattern,
		description:
			'Id of the board a pinned card originally lives in, so the client can link back to it. Only set inside a personal learning room.',
	})
	originBoardId?: string;

	@ApiPropertyOptional({
		description:
			'Name of the room or course the pinned card originally lives in, for the origin chip. Only set inside a personal learning room.',
	})
	originTitle?: string;
}
