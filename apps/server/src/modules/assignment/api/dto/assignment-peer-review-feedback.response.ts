import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';

export class AssignmentPeerReviewFeedbackFileResponse {
	constructor(props: AssignmentPeerReviewFeedbackFileResponse) {
		this.fileRecordId = props.fileRecordId;
		this.name = props.name;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	fileRecordId: string;

	@ApiProperty()
	name: string;
}

// One reviewer's identified feedback on a submission - the teacher view carries the reviewer's
// name, the submission owner's view (AssignmentSubmissionResponseMapper.mapForOwner) never does,
// and only ever includes reviews that have actually been submitted. See
// AssignmentUc.PeerReviewFeedbackEntry.
export class AssignmentPeerReviewFeedbackResponse {
	constructor(props: AssignmentPeerReviewFeedbackResponse) {
		this.reviewerUserId = props.reviewerUserId;
		this.reviewerFirstName = props.reviewerFirstName;
		this.reviewerLastName = props.reviewerLastName;
		this.points = props.points;
		this.feedbackComment = props.feedbackComment;
		this.submittedAt = props.submittedAt;
		this.files = props.files;
	}

	@ApiPropertyOptional({ description: 'omitted in the submission owner’s view - reviewers stay anonymous to them' })
	reviewerUserId?: string;

	@ApiPropertyOptional({ description: 'omitted in the submission owner’s view' })
	reviewerFirstName?: string;

	@ApiPropertyOptional({ description: 'omitted in the submission owner’s view' })
	reviewerLastName?: string;

	@ApiPropertyOptional({ type: Number, nullable: true })
	points?: number | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	feedbackComment?: string | null;

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		description: 'set once the reviewer has submitted this review',
	})
	submittedAt?: string | null;

	@ApiPropertyOptional({
		type: [AssignmentPeerReviewFeedbackFileResponse],
		nullable: true,
		description: "the reviewer's own annotated corrections, newest first",
	})
	files?: AssignmentPeerReviewFeedbackFileResponse[] | null;
}
