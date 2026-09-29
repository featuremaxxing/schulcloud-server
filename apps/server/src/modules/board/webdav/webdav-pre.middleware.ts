import { type NextFunction, type Request, type Response } from 'express';
import { sendWebDavOptions } from './webdav.constants';

const ORIGINAL_CONTENT_TYPE_HEADER = 'x-webdav-original-content-type';

/**
 * Has to run on the NestJS express instance *before* NestJS registers its own middleware
 * (see apps/server.app.ts), because two of those break WebDAV:
 *
 * - The global CORS middleware answers every OPTIONS request itself, without the DAV
 *   headers Windows and macOS look for. OPTIONS is therefore answered here.
 * - The JSON and urlencoded body parsers would consume uploads of .json files (or any file
 *   the client labels that way) and the file content would be lost. The content type is
 *   hidden from them and restored right after.
 */
export const createWebDavPreMiddleware =
	(route: string) =>
	(req: Request, res: Response, next: NextFunction): void => {
		if (req.path !== `/${route}` && !req.path.startsWith(`/${route}/`)) {
			next();
			return;
		}

		if (req.method.toUpperCase() === 'OPTIONS') {
			req.resume();
			sendWebDavOptions(res);
			return;
		}

		const contentType = req.headers['content-type'];
		if (contentType !== undefined) {
			req.headers[ORIGINAL_CONTENT_TYPE_HEADER] = contentType;
			delete req.headers['content-type'];
		}

		next();
	};

/** Undoes the header hiding of createWebDavPreMiddleware once the body parsers are passed. */
export const restoreWebDavContentType = (req: Request): void => {
	const original = req.headers[ORIGINAL_CONTENT_TYPE_HEADER];
	if (typeof original === 'string') {
		req.headers['content-type'] = original;
		delete req.headers[ORIGINAL_CONTENT_TYPE_HEADER];
	}
};
