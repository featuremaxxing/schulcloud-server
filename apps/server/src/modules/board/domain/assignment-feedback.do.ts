import { type EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { AssignmentFeedbackProps } from './types';

// The container for one author's artifacts on a submission (audio feedback, annotated
// corrections) - a child of an AssignmentSubmission, created lazily on that author's first
// upload. A submission can have several: one for the teacher (authorId undefined) and one per
// assigned peer reviewer (authorId = that reviewer's userId), each independently readable/
// writable - see hasPermissionForAssignmentFeedbackFile in board-node.rule.ts. Splitting these
// off into their own nodes (rather than attaching them to the submission node directly,
// distinguished only by filename prefix) is what lets BoardNodeRule authorize them per author:
// a peer reviewer needs write access to their own correction and read access to the submission
// itself, but never to the teacher's feedback nor another reviewer's.
export class AssignmentFeedback extends BoardNode<AssignmentFeedbackProps> {
	// undefined for the teacher's own container - see the class doc comment.
	get authorId(): EntityId | undefined {
		return this.props.userId;
	}

	set authorId(value: EntityId | undefined) {
		this.props.userId = value;
	}

	public canHaveChild(): boolean {
		return false;
	}
}

export const isAssignmentFeedback = (reference: unknown): reference is AssignmentFeedback =>
	reference instanceof AssignmentFeedback;
