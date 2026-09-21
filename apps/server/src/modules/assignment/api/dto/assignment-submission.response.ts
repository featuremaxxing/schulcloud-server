import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { AssignmentStatus } from '@modules/board';
import { AssignmentPeerReviewSummaryResponse } from './assignment-peer-review-summary.response';

export class AssignmentCriterionPointsResponse {
	constructor(props: AssignmentCriterionPointsResponse) {
		this.criterionId = props.criterionId;
		this.points = props.points;
	}

	@ApiProperty()
	criterionId: string;

	@ApiProperty()
	points: number;
}

export class AssignmentSubmissionFileResponse {
	constructor(props: AssignmentSubmissionFileResponse) {
		this.fileRecordId = props.fileRecordId;
		this.name = props.name;
		this.createdAt = props.createdAt;
		this.version = props.version;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	fileRecordId: string;

	@ApiProperty()
	name: string;

	@ApiPropertyOptional({ type: String, nullable: true, description: 'when this file was uploaded' })
	createdAt?: string | null;

	@ApiPropertyOptional({
		type: Number,
		nullable: true,
		description: 'only set for submission document versions - 1-based, oldest upload is version 1',
	})
	version?: number | null;
}

// Represents one student's row in the teacher's overview, or the caller's own submission.
// `id` is null when the student has not created a submission yet (placeholder row in the
// teacher's list). `points`/`feedbackComment` are withheld by the server (never just hidden
// by the client) until the submission has been returned - see
// AssignmentSubmissionResponseMapper.mapForOwner.
export class AssignmentSubmissionResponse {
	constructor(props: AssignmentSubmissionResponse) {
		this.id = props.id;
		this.userId = props.userId;
		this.firstName = props.firstName;
		this.lastName = props.lastName;
		this.status = props.status;
		this.submittedAt = props.submittedAt;
		this.isLate = props.isLate;
		this.file = props.file;
		this.points = props.points;
		this.feedbackComment = props.feedbackComment;
		this.returnedAt = props.returnedAt;
		this.comment = props.comment;
		this.feedbackAudio = props.feedbackAudio;
		this.feedbackFiles = props.feedbackFiles;
		this.fileVersions = props.fileVersions;
		this.criterionPoints = props.criterionPoints;
		this.peerReviews = props.peerReviews;
		this.gradedByFirstName = props.gradedByFirstName;
		this.gradedByLastName = props.gradedByLastName;
	}

	@ApiProperty({ type: String, nullable: true, pattern: bsonStringPattern })
	id: string | null;

	@ApiProperty({ pattern: bsonStringPattern })
	userId: string;

	@ApiPropertyOptional({ description: 'only present for the teacher view' })
	firstName?: string;

	@ApiPropertyOptional({ description: 'only present for the teacher view' })
	lastName?: string;

	@ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' })
	status: AssignmentStatus;

	@ApiPropertyOptional({ type: String, nullable: true })
	submittedAt: string | null;

	@ApiProperty()
	isLate: boolean;

	@ApiPropertyOptional({ type: AssignmentSubmissionFileResponse, nullable: true })
	file?: AssignmentSubmissionFileResponse | null;

	@ApiPropertyOptional({ type: Number, nullable: true })
	points?: number | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	feedbackComment?: string | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	returnedAt: string | null;

	@ApiPropertyOptional({ type: String, nullable: true, description: "the submitting student's optional note" })
	comment?: string | null;

	@ApiPropertyOptional({
		type: AssignmentSubmissionFileResponse,
		nullable: true,
		description: 'the teacher’s audio feedback; withheld from students until the submission has been returned',
	})
	feedbackAudio?: AssignmentSubmissionFileResponse | null;

	@ApiPropertyOptional({
		type: [AssignmentSubmissionFileResponse],
		nullable: true,
		description:
			'the teacher’s feedback files (annotated corrections), newest first; withheld from students until the submission has been returned',
	})
	feedbackFiles?: AssignmentSubmissionFileResponse[] | null;

	@ApiPropertyOptional({
		type: [AssignmentSubmissionFileResponse],
		nullable: true,
		description:
			'every submission document version the student has uploaded, newest first, including the current one; never withheld',
	})
	fileVersions?: AssignmentSubmissionFileResponse[] | null;

	@ApiPropertyOptional({
		type: [AssignmentCriterionPointsResponse],
		nullable: true,
		description: 'per-criterion points, only present for assignments with a rubric',
	})
	criterionPoints?: AssignmentCriterionPointsResponse[] | null;

	@ApiPropertyOptional({
		type: AssignmentPeerReviewSummaryResponse,
		nullable: true,
		description: 'advisory summary of student peer reviews - only present for the teacher view',
	})
	peerReviews?: AssignmentPeerReviewSummaryResponse | null;

	@ApiPropertyOptional({
		description:
			'first name of the teacher who graded this submission - relevant when a room has more than one teacher; only present for the teacher view, never for the submission owner',
	})
	gradedByFirstName?: string;

	@ApiPropertyOptional({
		description:
			'last name of the teacher who graded this submission - only present for the teacher view, never for the submission owner',
	})
	gradedByLastName?: string;
}
