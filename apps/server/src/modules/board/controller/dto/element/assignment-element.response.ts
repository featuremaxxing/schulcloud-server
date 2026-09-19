import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { InputFormat } from '@shared/domain/types';
import { ContentElementType } from '../../../domain';
import { TimestampsResponse } from '../timestamps.response';

export class AssignmentRubricCriterionResponse {
	constructor(props: AssignmentRubricCriterionResponse) {
		this.id = props.id;
		this.name = props.name;
		this.maxPoints = props.maxPoints;
	}

	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty()
	maxPoints: number;
}

// Deliberately holds only the teacher-authored configuration of the assignment, never
// anything about a specific student's submission (status, points, file). This response
// is broadcast to every board participant over the collaboration socket - see
// AssignmentSubmissionResponse (modules/assignment) for the per-user data, served only
// through the dedicated /assignments endpoints.
export class AssignmentElementContent {
	constructor(props: AssignmentElementContent) {
		this.title = props.title;
		this.text = props.text;
		this.inputFormat = props.inputFormat;
		this.startDate = props.startDate;
		this.dueDate = props.dueDate;
		this.graceMinutes = props.graceMinutes;
		this.maxPoints = props.maxPoints;
		this.lateUntil = props.lateUntil;
		this.criteria = props.criteria;
		this.peerReviewEnabled = props.peerReviewEnabled;
		this.peerReviewMode = props.peerReviewMode;
		this.peerReviewCount = props.peerReviewCount;
	}

	@ApiProperty()
	title: string;

	@ApiProperty()
	text: string;

	@ApiProperty({ enum: InputFormat, enumName: 'InputFormat' })
	inputFormat: InputFormat;

	@ApiPropertyOptional({ type: String, nullable: true })
	startDate: string | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	dueDate: string | null;

	@ApiPropertyOptional({ type: Number, nullable: true })
	graceMinutes: number | null;

	@ApiPropertyOptional({ type: Number, nullable: true })
	maxPoints: number | null;

	@ApiPropertyOptional({ type: String, nullable: true, description: 'dueDate + graceMinutes, derived' })
	lateUntil: string | null;

	@ApiPropertyOptional({
		type: [AssignmentRubricCriterionResponse],
		nullable: true,
		description: 'the grading rubric, when configured - absent/empty means flat-points grading',
	})
	criteria?: AssignmentRubricCriterionResponse[] | null;

	// read-only mirror of the peer review settings - changing them goes through the dedicated
	// /assignments/:elementId/peer-review-settings endpoint, not this content-update path
	@ApiProperty()
	peerReviewEnabled: boolean;

	@ApiProperty({ enum: ['manual', 'auto'] })
	peerReviewMode: 'manual' | 'auto';

	@ApiProperty()
	peerReviewCount: number;
}

export class AssignmentElementResponse {
	constructor(props: AssignmentElementResponse) {
		this.id = props.id;
		this.type = props.type;
		this.content = props.content;
		this.timestamps = props.timestamps;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id: string;

	@ApiProperty({ enum: ContentElementType, enumName: 'ContentElementType' })
	type: ContentElementType.ASSIGNMENT;

	@ApiProperty()
	content: AssignmentElementContent;

	@ApiProperty()
	timestamps: TimestampsResponse;
}
