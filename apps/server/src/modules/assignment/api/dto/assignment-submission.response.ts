import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { AssignmentStatus } from '@modules/board';

export class AssignmentSubmissionFileResponse {
	constructor(props: AssignmentSubmissionFileResponse) {
		this.fileRecordId = props.fileRecordId;
		this.name = props.name;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	fileRecordId: string;

	@ApiProperty()
	name: string;
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
}
