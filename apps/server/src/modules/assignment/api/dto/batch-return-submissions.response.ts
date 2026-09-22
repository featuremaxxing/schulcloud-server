import { ApiProperty } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { AssignmentSubmissionResponse } from './assignment-submission.response';

export class BatchReturnSubmissionsFailureResponse {
	constructor(props: BatchReturnSubmissionsFailureResponse) {
		this.submissionId = props.submissionId;
		this.reason = props.reason;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	submissionId: string;

	@ApiProperty()
	reason: string;
}

// A batch return is best-effort: submissions that are not yet graded (or that the caller
// cannot grade) are reported in `failed` instead of aborting the whole request, so a
// teacher's "return all graded" click still returns everyone it can.
export class BatchReturnSubmissionsResponse {
	constructor(props: BatchReturnSubmissionsResponse) {
		this.returned = props.returned;
		this.failed = props.failed;
	}

	@ApiProperty({ type: [AssignmentSubmissionResponse] })
	returned: AssignmentSubmissionResponse[];

	@ApiProperty({ type: [BatchReturnSubmissionsFailureResponse] })
	failed: BatchReturnSubmissionsFailureResponse[];
}
