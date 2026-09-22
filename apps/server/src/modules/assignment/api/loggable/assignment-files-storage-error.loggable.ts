import { type Loggable, type LoggableMessage } from '@shared/common/loggable';

export class AssignmentFilesStorageErrorLoggable implements Loggable {
	constructor(
		private readonly parentId: string,
		private readonly error: Error
	) {}

	public getLogMessage(): LoggableMessage {
		return {
			message: 'Listing files of an assignment submission failed; presenting the submission without its file.',
			data: {
				parentId: this.parentId,
				error: this.error.message,
			},
		};
	}
}
