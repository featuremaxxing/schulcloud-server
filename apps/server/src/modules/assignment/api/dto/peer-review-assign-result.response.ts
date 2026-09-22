import { ApiProperty } from '@nestjs/swagger';

export class PeerReviewAssignResultResponse {
	constructor(props: PeerReviewAssignResultResponse) {
		this.assignedCount = props.assignedCount;
	}

	@ApiProperty()
	assignedCount: number;
}
