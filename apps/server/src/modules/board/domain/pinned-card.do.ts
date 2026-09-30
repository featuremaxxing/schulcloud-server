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

	get note(): string | undefined {
		return this.props.note;
	}

	set note(value: string | undefined) {
		this.props.note = value;
	}

	public canHaveChild(_childNode: AnyBoardNode): boolean {
		return false;
	}
}

export const isPinnedCard = (reference: unknown): reference is PinnedCard => reference instanceof PinnedCard;

/**
 * What the learning room shows around a pinned card: where it lives (the origin
 * chip links back to it) and how far the owner is with it.
 */
export type PinnedCardInfo = {
	boardId: EntityId;
	title?: string;
	status?: PinnedCardStatus;
};

/**
 * The owner's own progress on the checkboxes, assignments and polls of a card -
 * the same completion rules as the progress bars of boards and rooms.
 */
export type PinnedCardStatus = {
	done: number;
	total: number;
	/** earliest due date of an assignment the owner has not handed in yet */
	nextDueDate?: Date;
};
