import { HttpStatus } from '@nestjs/common';
import { type Response } from 'express';

export const WEBDAV_ROUTE = 'webdav';

export const WEBDAV_ALLOWED_METHODS = [
	'OPTIONS',
	'PROPFIND',
	'PROPPATCH',
	'GET',
	'HEAD',
	'PUT',
	'MKCOL',
	'DELETE',
	'MOVE',
	'COPY',
	'LOCK',
	'UNLOCK',
];

// class 2 (locking) is what makes Finder and Windows Explorer mount the drive writable
export const sendWebDavOptions = (res: Response): void => {
	res
		.status(HttpStatus.OK)
		.set({
			DAV: '1, 2',
			'MS-Author-Via': 'DAV',
			Allow: WEBDAV_ALLOWED_METHODS.join(', '),
			'Content-Length': '0',
		})
		.end();
};
