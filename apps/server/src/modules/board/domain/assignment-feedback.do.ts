import { BoardNode } from './board-node.do';
import type { AssignmentFeedbackProps } from './types';

// The container for teacher-authored artifacts on a submission (audio feedback, annotated
// corrections) - a single child of exactly one AssignmentSubmission, created lazily on first
// upload. Splitting these off into their own node (rather than attaching them to the
// submission node directly, distinguished only by filename prefix) is what lets
// BoardNodeRule authorize them separately from the student's own submission file: a peer
// reviewer needs read access to the submission, but never to the teacher's feedback about it.
// See board-node.rule.ts's hasPermissionForAssignmentFeedbackFile.
export class AssignmentFeedback extends BoardNode<AssignmentFeedbackProps> {
	public canHaveChild(): boolean {
		return false;
	}
}

export const isAssignmentFeedback = (reference: unknown): reference is AssignmentFeedback =>
	reference instanceof AssignmentFeedback;
