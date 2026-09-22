import type { EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { AnyBoardNode, PinnedCardProps } from './types';

/**
 * Reference to a card living in another board, pinned by a user into their
 * personal learning room. The referenced card stays in its own tree - this node
 * only holds the pointer, so the card keeps being authorized through its own
 * board context.
 */
export class PinnedCard extends BoardNode<PinnedCardProps> {
	get referencedCardId(): EntityId {
		return this.props.referencedCardId;
	}

	public canHaveChild(_childNode: AnyBoardNode): boolean {
		return false;
	}
}

export const isPinnedCard = (reference: unknown): reference is PinnedCard => reference instanceof PinnedCard;
