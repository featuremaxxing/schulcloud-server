import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FileAreaNotifier } from '../service';
import { FileAreaUc } from '../uc';
import { WebDavFilesStorageClient } from './webdav-files-storage.client';
import { WebDavLockStore } from './webdav-lock.store';
import { MAX_VIRTUAL_FILE_BYTES, WebDavVirtualFile, WebDavVirtualFileStore } from './webdav-virtual-file.store';
import { isSystemFileName, sanitizeName } from './webdav-names';
import {
	FileResource,
	isCollection,
	isContainer,
	storageParentIdOf,
	WebDavCollection,
	WebDavContainer,
	WebDavResource,
} from './webdav-resource';
import { WebDavResourceResolver } from './webdav-resource.resolver';
import { WebDavSession } from './webdav-session';
import { sendWebDavOptions } from './webdav.constants';
import {
	escapeXml,
	parseLockOwner,
	parsePropPatchNames,
	renderLockResponse,
	renderMultiStatus,
	renderPropPatchResponse,
	WebDavPropEntry,
} from './webdav-xml';
import { WebDavError } from './webdav.error';

const MAX_XML_BODY_BYTES = 1024 * 1024;
const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';

export interface WebDavRequestContext {
	session: WebDavSession;
	segments: string[];
	// path of the drive root as the client sees it, e.g. /api/v3/webdav
	hrefPrefix: string;
	req: Request;
	res: Response;
}

/**
 * Implements the WebDAV methods for file areas. Folder changes go through the same use case
 * (and thus the same permission checks) as the file area REST API; file contents go to the
 * file storage, which checks permissions again for the user.
 */
@Injectable()
export class WebDavHandler {
	constructor(
		private readonly resolver: WebDavResourceResolver,
		private readonly filesStorageClient: WebDavFilesStorageClient,
		private readonly lockStore: WebDavLockStore,
		private readonly virtualFiles: WebDavVirtualFileStore,
		private readonly fileAreaUc: FileAreaUc,
		private readonly fileAreaNotifier: FileAreaNotifier
	) {}

	public async handle(ctx: WebDavRequestContext): Promise<void> {
		switch (ctx.req.method.toUpperCase()) {
			case 'OPTIONS':
				sendWebDavOptions(ctx.res);
				return;
			case 'PROPFIND':
				await this.propfind(ctx);
				return;
			case 'PROPPATCH':
				await this.proppatch(ctx);
				return;
			case 'GET':
				await this.get(ctx, true);
				return;
			case 'HEAD':
				await this.get(ctx, false);
				return;
			case 'PUT':
				await this.put(ctx);
				return;
			case 'MKCOL':
				await this.mkcol(ctx);
				return;
			case 'DELETE':
				await this.delete(ctx);
				return;
			case 'MOVE':
				await this.moveOrCopy(ctx, 'move');
				return;
			case 'COPY':
				await this.moveOrCopy(ctx, 'copy');
				return;
			case 'LOCK':
				await this.lock(ctx);
				return;
			case 'UNLOCK':
				this.unlock(ctx);
				return;
			default:
				throw WebDavError.methodNotAllowed();
		}
	}

	// --- read ---

	private async propfind(ctx: WebDavRequestContext): Promise<void> {
		await WebDavHandler.readBody(ctx.req);

		const depth = WebDavHandler.headerValue(ctx.req.headers.depth) ?? '1';
		if (depth.toLowerCase() === 'infinity') {
			// RFC 4918 9.1: servers may refuse, walking all boards of a user is too expensive
			ctx.res
				.status(HttpStatus.FORBIDDEN)
				.type(XML_CONTENT_TYPE)
				.send('<?xml version="1.0" encoding="utf-8"?><D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>');
			return;
		}

		const resource = await this.resolver.resolve(ctx.session, ctx.segments);
		if (!resource) {
			const virtualFile = this.virtualFiles.get(ctx.session.userId, ctx.segments);
			if (!virtualFile) {
				throw WebDavError.notFound();
			}
			const entry = WebDavHandler.virtualPropEntry(ctx.hrefPrefix, ctx.segments, virtualFile);
			ctx.res
				.status(207)
				.type(XML_CONTENT_TYPE)
				.send(renderMultiStatus([entry]));
			return;
		}
		const resources = [resource];
		if (depth !== '0' && isCollection(resource)) {
			resources.push(...(await this.resolver.listChildren(ctx.session, resource)));
		}

		const entries = resources.map((entry) => this.toPropEntry(ctx.hrefPrefix, entry));

		ctx.res.status(207).type(XML_CONTENT_TYPE).send(renderMultiStatus(entries));
	}

	private async proppatch(ctx: WebDavRequestContext): Promise<void> {
		const body = await WebDavHandler.readBody(ctx.req);
		const isVirtual = !!this.virtualFiles.get(ctx.session.userId, ctx.segments);
		if (!isVirtual && !WebDavHandler.isSystemFile(ctx.segments)) {
			await this.resolveOrFail(ctx.session, ctx.segments);
		}

		const names = await parsePropPatchNames(body);
		const href = WebDavHandler.buildHref(ctx.hrefPrefix, ctx.segments, false);

		ctx.res.status(207).type(XML_CONTENT_TYPE).send(renderPropPatchResponse(href, names));
	}

	private async get(ctx: WebDavRequestContext, withBody: boolean): Promise<void> {
		const resource = await this.resolver.resolve(ctx.session, ctx.segments);
		if (!resource) {
			const virtualFile = this.virtualFiles.get(ctx.session.userId, ctx.segments);
			if (!virtualFile) {
				throw WebDavError.notFound();
			}
			ctx.res.status(HttpStatus.OK).set({
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(virtualFile.content.length),
				'Last-Modified': virtualFile.updatedAt.toUTCString(),
			});
			ctx.res.end(withBody ? virtualFile.content : undefined);
			return;
		}

		if (isCollection(resource)) {
			await this.sendCollectionPage(ctx, resource, withBody);
			return;
		}

		const { fileRecord } = resource;
		const headers = {
			'Content-Type': fileRecord.mimeType || 'application/octet-stream',
			'Last-Modified': fileRecord.updatedAt.toUTCString(),
			ETag: WebDavHandler.etag(resource),
			'Accept-Ranges': 'bytes',
		};

		if (!withBody) {
			ctx.res
				.status(HttpStatus.OK)
				.set({ ...headers, 'Content-Length': String(fileRecord.size) })
				.end();
			return;
		}

		const jwt = await ctx.session.principal.getFilesStorageJwt();
		const download = await this.filesStorageClient.download(jwt, fileRecord, ctx.req.headers.range);

		ctx.res.status(download.status).set({ ...headers, ...download.headers });
		await pipeline(download.stream, ctx.res);
	}

	// a plain listing, useful when the drive URL is opened in a browser
	private async sendCollectionPage(
		ctx: WebDavRequestContext,
		resource: WebDavCollection,
		withBody: boolean
	): Promise<void> {
		const children = await this.resolver.listChildren(ctx.session, resource);
		const title = escapeXml(resource.segments[resource.segments.length - 1] ?? 'WebDAV');
		const items = children
			.map((child) => {
				const href = WebDavHandler.buildHref(ctx.hrefPrefix, child.segments, isCollection(child));
				const name = child.segments[child.segments.length - 1] + (isCollection(child) ? '/' : '');

				return `<li><a href="${escapeXml(href)}">${escapeXml(name)}</a></li>`;
			})
			.join('');
		const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><ul>${items}</ul></body></html>`;

		ctx.res.status(HttpStatus.OK).type('text/html; charset=utf-8');
		if (withBody) {
			ctx.res.send(html);
		} else {
			ctx.res.set('Content-Length', String(Buffer.byteLength(html))).end();
		}
	}

	// --- write ---

	private async put(ctx: WebDavRequestContext): Promise<void> {
		const name = WebDavHandler.lastSegment(ctx.segments);
		if (isSystemFileName(name)) {
			// kept aside, never stored in the file area - see WebDavVirtualFileStore
			const content = await WebDavHandler.readBinaryBody(ctx.req, MAX_VIRTUAL_FILE_BYTES);
			const created = this.virtualFiles.set(ctx.session.userId, ctx.segments, content);
			ctx.res.status(created ? HttpStatus.CREATED : HttpStatus.NO_CONTENT).end();
			return;
		}
		WebDavHandler.checkName(name);

		const parent = await this.resolveParentOrConflict(ctx.session, ctx.segments);
		const existing = await this.resolver.resolve(ctx.session, ctx.segments);
		if (existing && isCollection(existing)) {
			throw WebDavError.methodNotAllowed();
		}
		if (!isContainer(parent)) {
			throw WebDavError.forbidden('Files can only be stored in file areas and their folders');
		}

		const contentLength = WebDavHandler.contentLength(ctx.req);

		if (existing) {
			await this.replaceFile(ctx.session, existing, ctx.req, contentLength);
			ctx.res.status(HttpStatus.NO_CONTENT).end();
		} else {
			await this.createFile(ctx.session, parent, name, ctx.req, contentLength);
			ctx.res.status(HttpStatus.CREATED).end();
		}
		// a placeholder from a LOCK before the first PUT is now a real file
		this.virtualFiles.delete(ctx.session.userId, ctx.segments);
	}

	private async mkcol(ctx: WebDavRequestContext): Promise<void> {
		const body = await WebDavHandler.readBody(ctx.req);
		if (body.length > 0) {
			throw new WebDavError(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
		}

		const name = WebDavHandler.lastSegment(ctx.segments);
		WebDavHandler.checkName(name);

		const parent = await this.resolveParentOrConflict(ctx.session, ctx.segments);
		const existing = await this.resolver.resolve(ctx.session, ctx.segments);
		if (existing) {
			throw WebDavError.methodNotAllowed();
		}
		if (!isContainer(parent)) {
			// rooms and file areas themselves are managed in the web app
			throw WebDavError.forbidden('Cannot create a collection here');
		}

		await this.fileAreaUc.createFolder(ctx.session.userId, storageParentIdOf(parent), name);
		ctx.session.forgetBoard(parent.board.id);

		ctx.res.status(HttpStatus.CREATED).end();
	}

	private async delete(ctx: WebDavRequestContext): Promise<void> {
		await WebDavHandler.discardBody(ctx.req);

		const resource = await this.resolver.resolve(ctx.session, ctx.segments);
		if (!resource) {
			const wasVirtual = this.virtualFiles.delete(ctx.session.userId, ctx.segments);
			if (wasVirtual || WebDavHandler.isSystemFile(ctx.segments)) {
				ctx.res.status(HttpStatus.NO_CONTENT).end();
				return;
			}
			throw WebDavError.notFound();
		}

		await this.deleteResource(ctx.session, resource);

		ctx.res.status(HttpStatus.NO_CONTENT).end();
	}

	private async moveOrCopy(ctx: WebDavRequestContext, mode: 'move' | 'copy'): Promise<void> {
		await WebDavHandler.discardBody(ctx.req);

		const destinationSegments = WebDavHandler.parseDestination(
			WebDavHandler.headerValue(ctx.req.headers.destination),
			ctx.hrefPrefix
		);
		const destinationName = WebDavHandler.lastSegment(destinationSegments);
		const overwrite = (WebDavHandler.headerValue(ctx.req.headers.overwrite) ?? 'T').toUpperCase() !== 'F';

		if (WebDavHandler.isSystemFile(ctx.segments) || isSystemFileName(destinationName)) {
			const found = this.virtualFiles.copy(ctx.session.userId, ctx.segments, destinationSegments, mode === 'move');
			ctx.res.status(found ? HttpStatus.CREATED : HttpStatus.NOT_FOUND).end();
			return;
		}
		WebDavHandler.checkName(destinationName);

		const source = await this.resolveOrFail(ctx.session, ctx.segments);
		const destinationParent = await this.resolveParentOrConflict(ctx.session, destinationSegments);
		const destination = await this.resolver.resolve(ctx.session, destinationSegments);

		if (destination && WebDavHandler.isSameResource(source, destination)) {
			// a pure change of case ("foto.jpg" -> "Foto.jpg") resolves to the source itself
			if (mode === 'move' && WebDavHandler.lastSegment(source.segments) !== destinationName) {
				await this.rename(ctx.session, source, destinationName);
				ctx.res.status(HttpStatus.CREATED).end();
				return;
			}
			throw WebDavError.forbidden('Source and destination are the same');
		}

		if (destination) {
			if (!overwrite) {
				throw WebDavError.preconditionFailed();
			}
			if (isCollection(destination) || isCollection(source)) {
				throw WebDavError.forbidden('Only files can be replaced');
			}
			await this.deleteResource(ctx.session, destination);
		}

		if (mode === 'copy') {
			if (source.kind !== 'file' || !isContainer(destinationParent)) {
				throw WebDavError.forbidden('Only files can be copied');
			}
			await this.copyFile(ctx.session, source, destinationParent, destinationName);
		} else {
			await this.move(ctx.session, source, destinationParent, destinationName);
		}

		ctx.res.status(destination ? HttpStatus.NO_CONTENT : HttpStatus.CREATED).end();
	}

	private async lock(ctx: WebDavRequestContext): Promise<void> {
		const body = await WebDavHandler.readBody(ctx.req);
		const href = WebDavHandler.buildHref(ctx.hrefPrefix, ctx.segments, false);
		const timeout = WebDavHandler.headerValue(ctx.req.headers.timeout);

		// a LOCK without body refreshes the lock named in the If header
		if (!body.trim()) {
			const token = WebDavHandler.headerValue(ctx.req.headers.if)?.match(/<(opaquelocktoken:[^>]+)>/)?.[1];
			const refreshed = token ? this.lockStore.refresh(token, timeout) : undefined;
			if (!refreshed) {
				throw WebDavError.preconditionFailed();
			}
			ctx.res.status(HttpStatus.OK).type(XML_CONTENT_TYPE).send(renderLockResponse(refreshed));
			return;
		}

		// Locking an unmapped URL creates an empty resource (RFC 4918 7.3). Until the PUT
		// that follows it, that is a placeholder - an empty file would be left behind
		// whenever a client gives up in between.
		const { userId } = ctx.session;
		const exists =
			!!this.virtualFiles.get(userId, ctx.segments) || !!(await this.resolver.resolve(ctx.session, ctx.segments));
		if (!exists) {
			const parent = await this.resolveParentOrConflict(ctx.session, ctx.segments);
			const isSystemFile = WebDavHandler.isSystemFile(ctx.segments);
			if (!isSystemFile && !isContainer(parent)) {
				throw WebDavError.forbidden('Files can only be stored in file areas and their folders');
			}
			this.virtualFiles.set(userId, ctx.segments, Buffer.alloc(0), !isSystemFile);
		}
		const lock = this.lockStore.create(href, await parseLockOwner(body), timeout);

		ctx.res
			.status(exists ? HttpStatus.OK : HttpStatus.CREATED)
			.set('Lock-Token', `<${lock.token}>`)
			.type(XML_CONTENT_TYPE)
			.send(renderLockResponse(lock));
	}

	private unlock(ctx: WebDavRequestContext): void {
		const token = WebDavHandler.headerValue(ctx.req.headers['lock-token'])?.replace(/[<>]/g, '');
		if (token) {
			this.lockStore.remove(token);
		}

		ctx.res.status(HttpStatus.NO_CONTENT).end();
	}

	// --- operations ---

	private async createFile(
		session: WebDavSession,
		parent: WebDavContainer,
		name: string,
		content: Readable,
		contentLength?: number
	): Promise<void> {
		const jwt = await session.principal.getFilesStorageJwt();
		const parentId = storageParentIdOf(parent);

		await this.filesStorageClient.upload(jwt, parent.context.schoolId, parentId, name, content, contentLength);
		session.forgetFiles(parentId);
		this.fileAreaNotifier.filesChanged(parent.board.id, [parentId]);
	}

	private async replaceFile(
		session: WebDavSession,
		existing: FileResource,
		content: Readable,
		contentLength?: number
	): Promise<void> {
		const jwt = await session.principal.getFilesStorageJwt();
		const oldFile = existing.fileRecord;

		// Upload first so a failed upload keeps the old version. The file storage renames the
		// new file ("name (1).pdf") while the old one exists, so the name is restored after.
		const newFile = await this.filesStorageClient.upload(
			jwt,
			existing.context.schoolId,
			existing.parentId,
			oldFile.name,
			content,
			contentLength
		);
		await this.filesStorageClient.delete(jwt, oldFile.id);
		if (newFile.name !== oldFile.name) {
			await this.filesStorageClient.rename(jwt, newFile.id, oldFile.name);
		}
		session.forgetFiles(existing.parentId);
		this.fileAreaNotifier.filesChanged(existing.board.id, [existing.parentId]);
	}

	private async copyFile(
		session: WebDavSession,
		source: FileResource,
		target: WebDavContainer,
		name: string
	): Promise<void> {
		const jwt = await session.principal.getFilesStorageJwt();
		const download = await this.filesStorageClient.download(jwt, source.fileRecord);

		await this.createFile(session, target, name, download.stream, source.fileRecord.size);
	}

	private async deleteResource(session: WebDavSession, resource: WebDavResource): Promise<void> {
		switch (resource.kind) {
			case 'file': {
				const jwt = await session.principal.getFilesStorageJwt();
				await this.filesStorageClient.delete(jwt, resource.fileRecord.id);
				session.forgetFiles(resource.parentId);
				this.fileAreaNotifier.filesChanged(resource.board.id, [resource.parentId]);
				return;
			}
			case 'folder':
				await this.fileAreaUc.deleteFolder(session.userId, resource.folder.id);
				session.forgetBoard(resource.board.id);
				return;
			default:
				// deleting a whole file area by accident in a file manager is too easy
				throw WebDavError.forbidden('File areas and rooms cannot be deleted via WebDAV');
		}
	}

	private async rename(session: WebDavSession, resource: WebDavResource, name: string): Promise<void> {
		switch (resource.kind) {
			case 'file': {
				const jwt = await session.principal.getFilesStorageJwt();
				await this.filesStorageClient.rename(jwt, resource.fileRecord.id, name);
				session.forgetFiles(resource.parentId);
				this.fileAreaNotifier.filesChanged(resource.board.id, [resource.parentId]);
				return;
			}
			case 'folder':
				await this.fileAreaUc.renameFolder(session.userId, resource.folder.id, name);
				session.forgetBoard(resource.board.id);
				return;
			default:
				throw WebDavError.forbidden('File areas and rooms are renamed in the web app');
		}
	}

	private async move(
		session: WebDavSession,
		source: WebDavResource,
		destinationParent: WebDavCollection,
		name: string
	): Promise<void> {
		const sourceParentSegments = source.segments.slice(0, -1);
		const sourceParent = await this.resolveOrFail(session, sourceParentSegments);
		if (WebDavHandler.isSameResource(sourceParent, destinationParent)) {
			await this.rename(session, source, name);
			return;
		}
		if (!isContainer(destinationParent)) {
			throw WebDavError.forbidden(`Cannot move a ${source.kind} here`);
		}

		if (source.kind === 'file') {
			// the file storage cannot change the parent of a file, so this is copy + delete
			await this.copyFile(session, source, destinationParent, name);
			await this.deleteResource(session, source);
			return;
		}
		if (source.kind !== 'folder') {
			throw WebDavError.forbidden(`Cannot move a ${source.kind}`);
		}

		await this.fileAreaUc.moveFolder(session.userId, source.folder.id, storageParentIdOf(destinationParent));
		session.forgetBoard(source.board.id);
		session.forgetBoard(destinationParent.board.id);

		if (name !== WebDavHandler.lastSegment(source.segments)) {
			await this.rename(session, source, name);
		}
	}

	// --- helpers ---

	private async resolveOrFail(session: WebDavSession, segments: string[]): Promise<WebDavResource> {
		const resource = await this.resolver.resolve(session, segments);
		if (!resource) {
			throw WebDavError.notFound();
		}

		return resource;
	}

	// RFC 4918: a missing intermediate collection is a conflict, not "not found"
	private async resolveParentOrConflict(session: WebDavSession, segments: string[]): Promise<WebDavCollection> {
		if (segments.length === 0) {
			throw WebDavError.forbidden();
		}

		const parent = await this.resolver.resolve(session, segments.slice(0, -1));
		if (!parent || !isCollection(parent)) {
			throw WebDavError.conflict('Parent collection does not exist');
		}

		return parent;
	}

	private toPropEntry(hrefPrefix: string, resource: WebDavResource): WebDavPropEntry {
		const collection = isCollection(resource);
		const entry: WebDavPropEntry = {
			href: WebDavHandler.buildHref(hrefPrefix, resource.segments, collection),
			displayName: resource.segments[resource.segments.length - 1] ?? 'WebDAV',
			isCollection: collection,
		};

		switch (resource.kind) {
			case 'context':
				entry.createdAt = resource.context.createdAt;
				entry.updatedAt = resource.context.updatedAt;
				break;
			case 'board':
			case 'folder': {
				const props = (resource.kind === 'board' ? resource.board : resource.folder).getProps();
				entry.createdAt = props.createdAt;
				entry.updatedAt = props.updatedAt;
				break;
			}
			case 'file':
				entry.contentLength = resource.fileRecord.size;
				entry.contentType = resource.fileRecord.mimeType;
				entry.createdAt = resource.fileRecord.createdAt;
				entry.updatedAt = resource.fileRecord.updatedAt;
				entry.etag = WebDavHandler.etag(resource);
				break;
			default:
				break;
		}

		return entry;
	}

	private static virtualPropEntry(hrefPrefix: string, segments: string[], file: WebDavVirtualFile): WebDavPropEntry {
		return {
			href: WebDavHandler.buildHref(hrefPrefix, segments, false),
			displayName: WebDavHandler.lastSegment(segments),
			isCollection: false,
			contentLength: file.content.length,
			contentType: 'application/octet-stream',
			createdAt: file.createdAt,
			updatedAt: file.updatedAt,
			etag: `"virtual-${file.updatedAt.getTime()}"`,
		};
	}

	private static etag(resource: FileResource): string {
		return `"${resource.fileRecord.id}-${resource.fileRecord.updatedAt.getTime()}"`;
	}

	private static isSameResource(a: WebDavResource, b: WebDavResource): boolean {
		return (
			a.segments.length === b.segments.length &&
			a.segments.every((segment, index) => segment.toLowerCase() === b.segments[index].toLowerCase())
		);
	}

	private static isSystemFile(segments: string[]): boolean {
		return segments.length > 0 && isSystemFileName(segments[segments.length - 1]);
	}

	private static lastSegment(segments: string[]): string {
		return segments[segments.length - 1] ?? '';
	}

	// reject names the drive could not show back under the same name
	private static checkName(name: string): void {
		if (!name || sanitizeName(name, '') !== name) {
			throw WebDavError.badRequest(`Invalid name "${name}"`);
		}
	}

	public static buildHref(hrefPrefix: string, segments: string[], isCollectionHref: boolean): string {
		const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
		const trailingSlash = isCollectionHref && segments.length > 0 ? '/' : '';

		return `${hrefPrefix}/${path}${trailingSlash}`;
	}

	public static parseSegments(path: string): string[] {
		try {
			return path
				.split('/')
				.filter((segment) => segment.length > 0)
				.map((segment) => decodeURIComponent(segment));
		} catch {
			throw WebDavError.badRequest('Malformed path');
		}
	}

	private static parseDestination(destination: string | undefined, hrefPrefix: string): string[] {
		if (!destination) {
			throw WebDavError.badRequest('Missing Destination header');
		}

		let destinationUrl: URL;
		try {
			destinationUrl = new URL(destination, 'http://localhost');
		} catch {
			throw WebDavError.badRequest('Malformed Destination header');
		}
		const { pathname } = destinationUrl;
		if (pathname !== hrefPrefix && !pathname.startsWith(`${hrefPrefix}/`)) {
			throw new WebDavError(HttpStatus.BAD_GATEWAY, 'Destination is outside of this drive');
		}

		const segments = WebDavHandler.parseSegments(pathname.slice(hrefPrefix.length));
		if (segments.length === 0) {
			throw WebDavError.forbidden();
		}

		return segments;
	}

	private static headerValue(value: string | string[] | undefined): string | undefined {
		return Array.isArray(value) ? value[0] : value;
	}

	private static contentLength(req: Request): number | undefined {
		const value = req.headers['content-length'];
		const length = value ? Number.parseInt(value, 10) : NaN;

		return Number.isFinite(length) && length >= 0 ? length : undefined;
	}

	private static async readBody(req: Request): Promise<string> {
		if (typeof req.body === 'string') {
			return req.body;
		}
		if (req.readableEnded) {
			return '';
		}

		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req as AsyncIterable<Buffer | string>) {
			const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
			size += buffer.length;
			if (size > MAX_XML_BODY_BYTES) {
				throw new WebDavError(HttpStatus.PAYLOAD_TOO_LARGE);
			}
			chunks.push(buffer);
		}

		return Buffer.concat(chunks).toString('utf8');
	}

	// reads up to maxBytes and silently drops the rest
	private static async readBinaryBody(req: Request, maxBytes: number): Promise<Buffer> {
		if (req.readableEnded) {
			return Buffer.alloc(0);
		}

		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req as AsyncIterable<Buffer | string>) {
			const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
			if (size < maxBytes) {
				chunks.push(buffer.subarray(0, maxBytes - size));
			}
			size += buffer.length;
		}

		return Buffer.concat(chunks);
	}

	private static async discardBody(req: Request): Promise<void> {
		if (req.readableEnded) {
			return;
		}

		for await (const chunk of req as AsyncIterable<unknown>) {
			// drain
			void chunk;
		}
	}
}
