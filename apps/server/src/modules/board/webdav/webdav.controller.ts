import { ErrorLoggable } from '@infra/error';
import { ErrorLogger } from '@infra/logger';
import { All, Controller, HttpException, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { RequestTimeout } from '@shared/common/decorators';
import { Request, Response } from 'express';
import { WebDavAuthService } from './webdav-auth.service';
import { restoreWebDavContentType } from './webdav-pre.middleware';
import { WebDavSession } from './webdav-session';
import { sendWebDavOptions, WEBDAV_ROUTE } from './webdav.constants';
import { WEBDAV_CONFIG_TOKEN, WEBDAV_INCOMING_REQUEST_TIMEOUT_KEY, WebDavConfig } from './webdav.config';
import { WebDavError } from './webdav.error';
import { WebDavHandler } from './webdav.handler';

const REALM = 'Board-Dateien';

/**
 * Entry point of the WebDAV drive (/api/v3/webdav). WebDAV clients neither log in via the
 * web app nor read JSON errors, so this controller answers everything itself: Basic auth
 * with an app password, plain status codes, XML bodies.
 */
@ApiExcludeController()
@RequestTimeout(WEBDAV_INCOMING_REQUEST_TIMEOUT_KEY)
@Controller(WEBDAV_ROUTE)
export class WebDavController {
	constructor(
		private readonly webDavAuthService: WebDavAuthService,
		private readonly webDavHandler: WebDavHandler,
		private readonly errorLogger: ErrorLogger,
		@Inject(WEBDAV_CONFIG_TOKEN) private readonly config: WebDavConfig
	) {}

	@All()
	public serveRoot(@Req() req: Request, @Res() res: Response): Promise<void> {
		return this.serve(req, res);
	}

	@All('*path')
	public servePath(@Req() req: Request, @Res() res: Response): Promise<void> {
		return this.serve(req, res);
	}

	private async serve(req: Request, res: Response): Promise<void> {
		restoreWebDavContentType(req);

		if (!this.config.featureWebDavEnabled) {
			req.resume();
			res.status(HttpStatus.NOT_FOUND).end();
			return;
		}

		// clients probe the capabilities before sending credentials
		if (req.method.toUpperCase() === 'OPTIONS') {
			req.resume();
			sendWebDavOptions(res);
			return;
		}

		try {
			const principal = await this.webDavAuthService.authenticate(req.headers.authorization);
			if (!principal) {
				req.resume();
				res.status(HttpStatus.UNAUTHORIZED).set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`).end();
				return;
			}

			const hrefPrefix = `${req.baseUrl}/${WEBDAV_ROUTE}`;
			const relativePath = req.path.replace(new RegExp(`^/${WEBDAV_ROUTE}`), '');
			const segments = WebDavHandler.parseSegments(relativePath);

			await this.webDavHandler.handle({ session: new WebDavSession(principal), segments, hrefPrefix, req, res });
		} catch (error: unknown) {
			this.sendError(req, res, error);
		}
	}

	private sendError(req: Request, res: Response, error: unknown): void {
		const status = WebDavController.statusOf(error);
		if (status >= 500) {
			this.errorLogger.error(new ErrorLoggable(error, { method: req.method, path: req.path }));
		}

		if (res.headersSent) {
			// a download failed midway - all we can do is cut the connection
			res.destroy();
			return;
		}

		req.resume();
		res.status(status).end();
	}

	private static statusOf(error: unknown): number {
		if (error instanceof WebDavError) {
			return error.status;
		}
		if (error instanceof HttpException) {
			return error.getStatus();
		}

		return HttpStatus.INTERNAL_SERVER_ERROR;
	}
}
