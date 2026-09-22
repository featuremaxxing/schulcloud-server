import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Advisory only - never rolled into points/criterionPoints, see AssignmentUc.buildPeerReviewSummary.
// Reviewer identities are intentionally omitted here too, symmetric with the reviewer never
// seeing the submitter's name.
export class AssignmentPeerReviewSummaryResponse {
	constructor(props: AssignmentPeerReviewSummaryResponse) {
		this.averagePoints = props.averagePoints;
		this.count = props.count;
		this.comments = props.comments;
	}

	@ApiPropertyOptional({ type: Number, nullable: true })
	averagePoints: number | null;

	@ApiProperty()
	count: number;

	@ApiProperty({ type: [String] })
	comments: string[];
}
