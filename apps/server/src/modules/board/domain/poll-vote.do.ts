import { type EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { PollAnswer, PollVoteProps } from './types';

// A vote is never a content element itself (it cannot be created via the "add element"
// dialog) but a regular node in the board tree, one per participant, living below its
// PollElement. All of a user's answers to all questions live in this single node.
export class PollVote extends BoardNode<PollVoteProps> {
	get userId(): EntityId {
		return this.props.userId;
	}

	set userId(value: EntityId) {
		this.props.userId = value;
	}

	get votedAt(): Date | undefined {
		return this.props.votedAt;
	}

	set votedAt(value: Date | undefined) {
		this.props.votedAt = value;
	}

	get answers(): PollAnswer[] {
		return this.props.answers;
	}

	set answers(value: PollAnswer[]) {
		this.props.answers = value;
	}

	public canHaveChild(): boolean {
		return false;
	}
}

export const isPollVote = (reference: unknown): reference is PollVote => reference instanceof PollVote;
