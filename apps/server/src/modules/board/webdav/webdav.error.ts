import { HttpStatus } from '@nestjs/common';

/**
 * An error that is answered with a plain WebDAV status code. WebDAV clients do not read
 * JSON error bodies - they only care about the status.
 */
export class WebDavError extends Error {
	constructor(
		public readonly status: HttpStatus,
		message?: string
	) {
		super(message ?? `WebDAV error ${status}`);
	}

	public static notFound(): WebDavError {
		return new WebDavError(HttpStatus.NOT_FOUND);
	}

	public static forbidden(message?: string): WebDavError {
		return new WebDavError(HttpStatus.FORBIDDEN, message);
	}

	public static conflict(message?: string): WebDavError {
		return new WebDavError(HttpStatus.CONFLICT, message);
	}

	public static badRequest(message?: string): WebDavError {
		return new WebDavError(HttpStatus.BAD_REQUEST, message);
	}

	public static methodNotAllowed(): WebDavError {
		return new WebDavError(HttpStatus.METHOD_NOT_ALLOWED);
	}

	public static preconditionFailed(): WebDavError {
		return new WebDavError(HttpStatus.PRECONDITION_FAILED);
	}

	public static badGateway(message?: string): WebDavError {
		return new WebDavError(HttpStatus.BAD_GATEWAY, message);
	}
}
