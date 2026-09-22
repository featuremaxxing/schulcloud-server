import { ApiProperty } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';

// Returned by the "ensure feedback container" endpoint, which a teacher calls before their
// first upload of audio feedback or an annotated correction for a submission - see
// AssignmentUc.ensureFeedbackContainer and AssignmentFeedback's doc comment.
export class AssignmentFeedbackContainerResponse {
	constructor(props: AssignmentFeedbackContainerResponse) {
		this.feedbackContainerId = props.feedbackContainerId;
	}

	@ApiProperty({ pattern: bsonStringPattern, description: 'upload teacher feedback files to this id' })
	feedbackContainerId: string;
}
