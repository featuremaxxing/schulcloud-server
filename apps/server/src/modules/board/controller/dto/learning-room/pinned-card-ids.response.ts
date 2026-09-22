import { ApiProperty } from '@nestjs/swagger';

export class PinnedCardIdsResponse {
	constructor(cardIds: string[]) {
		this.cardIds = cardIds;
	}

	@ApiProperty({ type: [String], description: 'Ids of the cards this user has pinned' })
	cardIds: string[];
}
