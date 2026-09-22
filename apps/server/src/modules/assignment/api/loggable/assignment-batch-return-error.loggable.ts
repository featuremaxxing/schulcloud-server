import { type Loggable, type LoggableMessage } from '@shared/common/loggable';

// The original error is logged here rather than returned in the API response - see
// AssignmentUc.toBatchFailureReason, which reports only one of two generic reasons to the
// caller so an unexpected exception's message never leaks past the API boundary.
export class AssignmentBatchReturnErrorLoggable implements Loggable {
	constructor(
		private readonly submissionId: string,
		private readonly error: Error
	) {}

	public getLogMessage(): LoggableMessage {
		return {
			message: 'Returning a submission as part of a batch return failed for an unexpected reason.',
			data: {
				submissionId: this.submissionId,
				error: this.error.message,
			},
		};
	}
}
