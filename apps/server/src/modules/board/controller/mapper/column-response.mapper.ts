import { InternalServerErrorException } from '@nestjs/common';
import { Card, type Column, PinnedCard } from '../../domain';
import { CardSkeletonResponse, ColumnFullResponse, ColumnResponse, TimestampsResponse } from '../dto';
import { CardResponseMapper } from './card-response.mapper';

// only used for prerendering before the real card arrives
const PINNED_CARD_PRERENDER_HEIGHT = 150;

export class ColumnResponseMapper {
	public static mapToResponse(column: Column): ColumnResponse {
		const result = new ColumnResponse({
			id: column.id,
			title: column.title ?? '',
			cards: column.children.map((card) => {
				// pinned cards point at a card in another board - hand out the referenced
				// id so the client loads it through the regular card api (which authorizes
				// it in its own board context), plus the pointer id for moving/unpinning
				if (card instanceof PinnedCard) {
					return new CardSkeletonResponse({
						cardId: card.referencedCardId,
						height: PINNED_CARD_PRERENDER_HEIGHT,
						pinnedCardId: card.id,
					});
				}
				/* istanbul ignore next */
				if (!(card instanceof Card)) {
					throw new InternalServerErrorException(`unsupported child type: ${card.constructor.name}`);
				}
				return new CardSkeletonResponse({
					cardId: card.id,
					height: card.height,
				});
			}),
			timestamps: new TimestampsResponse({ lastUpdatedAt: column.updatedAt, createdAt: column.createdAt }),
		});
		return result;
	}

	public static mapToFullResponse(column: Column): ColumnFullResponse {
		const result = new ColumnFullResponse({
			id: column.id,
			title: column.title ?? '',
			// pinned cards are pointers, their content is not part of this tree
			cards: column.children
				.filter((card) => !(card instanceof PinnedCard))
				.map((card) => {
					/* istanbul ignore next */
					if (!(card instanceof Card)) {
						throw new InternalServerErrorException(`unsupported child type: ${card.constructor.name}`);
					}
					return CardResponseMapper.mapToResponse(card);
				}),
			timestamps: new TimestampsResponse({ lastUpdatedAt: column.updatedAt, createdAt: column.createdAt }),
		});
		return result;
	}
}
