import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { AssignmentReviewAssignmentMode } from '@modules/board';

// The teacher's view of one reviewer<->submission pairing - identifies both sides, unlike the
// reviewer-facing PeerReviewTaskResponse (which deliberately hides the submission owner) and
// the submission owner-facing AssignmentPeerReviewSummaryResponse (which deliberately hides the
// reviewer). Only ever returned to a board editor, see PeerReviewUc.loadElementForTeacher.
export class PeerReviewAssignmentResponse {
	constructor(props: PeerReviewAssignmentResponse) {
		this.submissionId = props.submissionId;
		this.reviewerUserId = props.reviewerUserId;
		this.reviewerFirstName = props.reviewerFirstName;
		this.reviewerLastName = props.reviewerLastName;
		this.assignmentMode = props.assignmentMode;
		this.submittedAt = props.submittedAt;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	submissionId: string;

	@ApiProperty({ pattern: bsonStringPattern })
	reviewerUserId: string;

	@ApiPropertyOptional()
	reviewerFirstName?: string;

	@ApiPropertyOptional()
	reviewerLastName?: string;

	@ApiProperty({ enum: AssignmentReviewAssignmentMode, enumName: 'AssignmentReviewAssignmentMode' })
	assignmentMode: AssignmentReviewAssignmentMode;

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		description: 'set once the reviewer has submitted their review - such an assignment can no longer be removed',
	})
	submittedAt?: string | null;
}
