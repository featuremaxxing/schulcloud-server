import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssignmentSubmissionResponse } from './assignment-submission.response';

// Separate from the board module's element-edit response (AssignmentRubricCriterionResponse) -
// this one is what the grading UI reads, kept independent to avoid a board <-> assignment
// module dependency in either direction.
export class AssignmentSubmissionRubricCriterionResponse {
	constructor(props: AssignmentSubmissionRubricCriterionResponse) {
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

export class AssignmentSubmissionListResponse {
	constructor(props: AssignmentSubmissionListResponse) {
		this.maxPoints = props.maxPoints;
		this.dueDate = props.dueDate;
		this.lateUntil = props.lateUntil;
		this.isSubmittable = props.isSubmittable;
		this.submissions = props.submissions;
		this.criteria = props.criteria;
	}

	@ApiPropertyOptional({ type: Number, nullable: true })
	maxPoints: number | null;

	@ApiPropertyOptional({
		type: [AssignmentSubmissionRubricCriterionResponse],
		nullable: true,
		description: 'the grading rubric, when configured - absent/empty means flat-points grading',
	})
	criteria?: AssignmentSubmissionRubricCriterionResponse[] | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	dueDate: string | null;

	@ApiPropertyOptional({ type: String, nullable: true, description: 'dueDate + graceMinutes, derived' })
	lateUntil: string | null;

	@ApiProperty({ description: 'whether a new or replacing submission can be made right now' })
	isSubmittable: boolean;

	@ApiProperty({ type: () => [AssignmentSubmissionResponse] })
	submissions: AssignmentSubmissionResponse[];
}
