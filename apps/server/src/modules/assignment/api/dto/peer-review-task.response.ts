import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';

// A review task as seen by the reviewing student - deliberately carries no information about
// who submitted the work (no name, no userId), only the submission id (opaque to the client)
// and its file, so the reviewer stays anonymous to... wait, so the SUBMITTER stays anonymous
// to the reviewer. See PeerReviewResponseMapper.
export class PeerReviewTaskFileResponse {
	constructor(props: PeerReviewTaskFileResponse) {
		this.fileRecordId = props.fileRecordId;
		this.name = props.name;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	fileRecordId: string;

	@ApiProperty()
	name: string;
}

export class PeerReviewTaskResponse {
	constructor(props: PeerReviewTaskResponse) {
		this.id = props.id;
		this.submissionId = props.submissionId;
		this.file = props.file;
		this.assignedAt = props.assignedAt;
		this.submittedAt = props.submittedAt;
		this.points = props.points;
		this.feedbackComment = props.feedbackComment;
		this.feedbackContainerId = props.feedbackContainerId;
		this.correctionFiles = props.correctionFiles;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id: string;

	@ApiProperty({ pattern: bsonStringPattern })
	submissionId: string;

	@ApiPropertyOptional({ type: PeerReviewTaskFileResponse, nullable: true })
	file?: PeerReviewTaskFileResponse | null;

	@ApiProperty()
	assignedAt: string;

	@ApiPropertyOptional({ type: String, nullable: true })
	submittedAt?: string | null;

	@ApiPropertyOptional({ type: Number, nullable: true })
	points?: number | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	feedbackComment?: string | null;

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		pattern: bsonStringPattern,
		description: "id of this reviewer's own correction container, once one exists - upload target for new corrections",
	})
	feedbackContainerId?: string | null;

	@ApiPropertyOptional({
		type: [PeerReviewTaskFileResponse],
		nullable: true,
		description: "this reviewer's own annotated corrections on the submission, newest first",
	})
	correctionFiles?: PeerReviewTaskFileResponse[] | null;
}
