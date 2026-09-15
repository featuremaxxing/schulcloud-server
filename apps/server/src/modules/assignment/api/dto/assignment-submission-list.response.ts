import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssignmentSubmissionResponse } from './assignment-submission.response';

export class AssignmentSubmissionListResponse {
	constructor(props: AssignmentSubmissionListResponse) {
		this.maxPoints = props.maxPoints;
		this.dueDate = props.dueDate;
		this.lateUntil = props.lateUntil;
		this.isSubmittable = props.isSubmittable;
		this.submissions = props.submissions;
	}

	@ApiPropertyOptional({ type: Number, nullable: true })
	maxPoints: number | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	dueDate: string | null;

	@ApiPropertyOptional({ type: String, nullable: true, description: 'dueDate + graceMinutes, derived' })
	lateUntil: string | null;

	@ApiProperty({ description: 'whether a new or replacing submission can be made right now' })
	isSubmittable: boolean;

	@ApiProperty({ type: () => [AssignmentSubmissionResponse] })
	submissions: AssignmentSubmissionResponse[];
}
