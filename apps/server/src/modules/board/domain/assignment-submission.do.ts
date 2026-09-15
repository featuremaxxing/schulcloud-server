import { type EntityId } from '@shared/domain/types';
import { AssignmentStatus } from './assignment-status.enum';
import { BoardNode } from './board-node.do';
import type { AssignmentSubmissionProps } from './types';

// A submission is never a content element itself (it cannot be added via the
// "add element" dialog) but a regular node in the board tree, one per student,
// living below its AssignmentElement. This keeps the file attached to it
// authorizable through the existing BoardNode -> FileRecordParentType.BoardNode path.
export class AssignmentSubmission extends BoardNode<AssignmentSubmissionProps> {
	get userId(): EntityId {
		return this.props.userId;
	}

	set userId(value: EntityId) {
		this.props.userId = value;
	}

	get submittedAt(): Date | undefined {
		return this.props.submittedAt;
	}

	set submittedAt(value: Date | undefined) {
		this.props.submittedAt = value;
	}

	get isLate(): boolean {
		return this.props.isLate ?? false;
	}

	set isLate(value: boolean) {
		this.props.isLate = value;
	}

	// The submitting student's optional note. Sent along with a (re)submit; the
	// teacher's answer is the separate feedbackComment.
	get comment(): string | undefined {
		return this.props.comment;
	}

	set comment(value: string | undefined) {
		this.props.comment = value;
	}

	get points(): number | undefined {
		return this.props.points;
	}

	set points(value: number | undefined) {
		this.props.points = value;
	}

	get feedbackComment(): string | undefined {
		return this.props.feedbackComment;
	}

	set feedbackComment(value: string | undefined) {
		this.props.feedbackComment = value;
	}

	get returnedAt(): Date | undefined {
		return this.props.returnedAt;
	}

	set returnedAt(value: Date | undefined) {
		this.props.returnedAt = value;
	}

	get gradedBy(): EntityId | undefined {
		return this.props.gradedBy;
	}

	set gradedBy(value: EntityId | undefined) {
		this.props.gradedBy = value;
	}

	// Status is derived, never persisted directly, so that no invalid combination
	// of fields can exist. isLate is the one deliberate exception (see the setter
	// callers): it is fixed at submission time so a later change of the due date
	// cannot retroactively change the verdict on an already-made submission.
	public getStatus(): AssignmentStatus {
		if (this.returnedAt) {
			return AssignmentStatus.RETURNED;
		}
		if (this.points !== undefined || this.feedbackComment !== undefined) {
			return AssignmentStatus.IN_REVIEW;
		}
		if (this.submittedAt) {
			return AssignmentStatus.SUBMITTED;
		}
		return AssignmentStatus.OPEN;
	}

	// V1: a submission holds exactly one file, attached directly to this node
	// (FileRecordParentType.BoardNode). No child board nodes yet. V2 (in-platform
	// correction: annotated PDF, audio feedback) is expected to add a feedback
	// child node here, so this stays a deliberate, revisitable false rather than
	// removing canHaveChild entirely.
	public canHaveChild(): boolean {
		return false;
	}
}

export const isAssignmentSubmission = (reference: unknown): reference is AssignmentSubmission =>
	reference instanceof AssignmentSubmission;
