import { type Loggable, type LoggableMessage } from '@shared/common/loggable';

export class AiRequestFailedLoggable implements Loggable {
	constructor(private readonly error: Error) {}

	public getLogMessage(): LoggableMessage {
		return {
			message: 'The AI request failed; surfacing a 503 to the caller without persisting anything.',
			data: {
				error: this.error.message,
			},
		};
	}
}

export class AiRequestRejectedLoggable implements Loggable {
	constructor(private readonly status: number) {}

	public getLogMessage(): LoggableMessage {
		return {
			message: 'The AI provider rejected the request; surfacing a 503 to the caller without persisting anything.',
			data: {
				status: this.status,
			},
		};
	}
}

export class AiResponseWithoutContentLoggable implements Loggable {
	public getLogMessage(): LoggableMessage {
		return {
			message: 'The AI provider answered without message content; surfacing a 503 to the caller.',
		};
	}
}
