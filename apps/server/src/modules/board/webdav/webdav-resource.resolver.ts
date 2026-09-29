import { RoomService } from '@modules/room';
import { RoomMembershipService } from '@modules/room-membership';
import { Injectable } from '@nestjs/common';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { AnyBoardNode, BoardExternalReferenceType, ColumnBoard, FileAreaFolder, isFileAreaFolder } from '../domain';
import { BoardNodeAuthorizableService, ColumnBoardService } from '../service';
import { WebDavFileRecord, WebDavFilesStorageClient } from './webdav-files-storage.client';
import { assignUniqueNames, sanitizeName } from './webdav-names';
import {
	FALLBACK_NAMES,
	isCollection,
	WebDavCollection,
	WebDavContainer,
	WebDavContext,
	WebDavResource,
} from './webdav-resource';
import { WebDavSession } from './webdav-session';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ChildWithoutSegments = DistributiveOmit<WebDavResource, 'segments'> & { name: string };
type ContainerEntry = { folder: FileAreaFolder } | { fileRecord: WebDavFileRecord };

const byCreation = (a: { createdAt?: Date; id: string }, b: { createdAt?: Date; id: string }): number =>
	(a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id);

/**
 * Maps the file areas a user can read onto a directory tree:
 *
 *   /<room>/<file area>/<folder>/.../<file>
 *
 * Only file areas (boards with layout FILES) are part of the drive; other boards and courses
 * are not. Names are derived from titles on every request (there is no stored mapping), so the
 * order in which siblings are listed decides which duplicate gets the " (2)" suffix.
 */
@Injectable()
export class WebDavResourceResolver {
	constructor(
		private readonly roomService: RoomService,
		private readonly roomMembershipService: RoomMembershipService,
		private readonly columnBoardService: ColumnBoardService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly filesStorageClient: WebDavFilesStorageClient
	) {}

	public async resolve(session: WebDavSession, segments: string[]): Promise<WebDavResource | undefined> {
		let current: WebDavResource = { kind: 'root', segments: [] };

		for (const segment of segments) {
			if (!isCollection(current)) {
				return undefined;
			}

			const children = await this.listChildren(session, current);
			const lowerCaseSegment = segment.toLowerCase();
			const match =
				children.find((child) => child.segments[child.segments.length - 1] === segment) ??
				children.find((child) => child.segments[child.segments.length - 1].toLowerCase() === lowerCaseSegment);
			if (!match) {
				return undefined;
			}
			current = match;
		}

		return current;
	}

	public async listChildren(session: WebDavSession, collection: WebDavCollection): Promise<WebDavResource[]> {
		const children = await this.loadChildren(session, collection);

		return children.map(({ name, ...child }) => {
			return { ...child, segments: [...collection.segments, name] };
		});
	}

	/** The fully loaded board tree (the board listing only loads the root node). */
	public getBoardTree(session: WebDavSession, boardId: string): Promise<ColumnBoard> {
		return session.memoize(session.boardTrees, boardId, () => this.columnBoardService.findById(boardId));
	}

	public getFiles(session: WebDavSession, context: WebDavContext, parentId: string): Promise<WebDavFileRecord[]> {
		return session.memoize(session.files, parentId, async () => {
			const jwt = await session.principal.getFilesStorageJwt();
			const files = await this.filesStorageClient.list(jwt, context.schoolId, parentId);

			return files.sort(byCreation);
		});
	}

	private async loadChildren(session: WebDavSession, collection: WebDavCollection): Promise<ChildWithoutSegments[]> {
		switch (collection.kind) {
			case 'root': {
				const rooms = await this.getRoomsWithFileAreas(session);

				return assignUniqueNames(
					rooms,
					(room) => sanitizeName(room.name, FALLBACK_NAMES.context),
					() => false
				).map(({ entry, name }) => {
					return { kind: 'context' as const, context: entry, name };
				});
			}
			case 'context': {
				const boards = await this.getReadableFileAreas(session, collection.context);

				return assignUniqueNames(
					boards,
					(board) => sanitizeName(board.title, FALLBACK_NAMES.board),
					() => false
				).map(({ entry, name }) => {
					return { kind: 'board' as const, context: collection.context, board: entry, name };
				});
			}
			default:
				return this.loadContainerChildren(session, collection);
		}
	}

	// subfolders and files of a folder (or of the file area itself) share one namespace, folders first
	private async loadContainerChildren(
		session: WebDavSession,
		collection: WebDavContainer
	): Promise<ChildWithoutSegments[]> {
		const board = await this.getBoardTree(session, collection.board.id);
		const containerId = collection.kind === 'board' ? board.id : collection.folder.id;
		const container = collection.kind === 'board' ? board : this.findFolder(board, containerId);
		const folders = container ? container.children.filter(isFileAreaFolder) : [];
		const files = await this.getFiles(session, collection.context, containerId);

		const entries: ContainerEntry[] = [
			...folders.map((folder): ContainerEntry => {
				return { folder };
			}),
			...files.map((fileRecord): ContainerEntry => {
				return { fileRecord };
			}),
		];

		return assignUniqueNames(
			entries,
			(entry) =>
				'folder' in entry
					? sanitizeName(entry.folder.title, FALLBACK_NAMES.folder)
					: sanitizeName(entry.fileRecord.name, FALLBACK_NAMES.file),
			(entry) => 'fileRecord' in entry
		).map(({ entry, name }): ChildWithoutSegments => {
			if ('folder' in entry) {
				return { kind: 'folder', context: collection.context, board, folder: entry.folder, name };
			}

			return {
				kind: 'file',
				context: collection.context,
				board,
				parentId: containerId,
				fileRecord: entry.fileRecord,
				name,
			};
		});
	}

	private findFolder(node: AnyBoardNode, folderId: string): FileAreaFolder | undefined {
		for (const child of node.children) {
			if (isFileAreaFolder(child)) {
				if (child.id === folderId) {
					return child;
				}
				const found = this.findFolder(child, folderId);
				if (found) {
					return found;
				}
			}
		}

		return undefined;
	}

	private getRoomsWithFileAreas(session: WebDavSession): Promise<WebDavContext[]> {
		return session.memoize(session.contexts, 'rooms', async () => {
			const roomAuthorizables = await this.roomMembershipService.getRoomAuthorizablesByUserId(session.userId);
			const rooms = await this.roomService.getRoomsByIds(roomAuthorizables.map((authorizable) => authorizable.roomId));
			const contexts = rooms.map((room): WebDavContext => {
				return {
					id: room.id,
					name: room.name,
					schoolId: room.schoolId,
					createdAt: room.createdAt,
					updatedAt: room.updatedAt,
				};
			});

			const withFileAreas = await Promise.all(
				contexts.map(async (context) => {
					const fileAreas = await this.getReadableFileAreas(session, context);

					return fileAreas.length > 0 ? context : undefined;
				})
			);

			return withFileAreas.filter((context): context is WebDavContext => !!context).sort(byCreation);
		});
	}

	private getReadableFileAreas(session: WebDavSession, context: WebDavContext): Promise<ColumnBoard[]> {
		return session.memoize(session.boardsOfContext, context.id, async () => {
			const boards = await this.columnBoardService.findByExternalReference(
				{ type: BoardExternalReferenceType.Room, id: context.id },
				0
			);
			const fileAreas = boards.filter((board) => board.isFileArea());
			if (fileAreas.length === 0) {
				return [];
			}

			const authorizables = await this.boardNodeAuthorizableService.getBoardAuthorizables(fileAreas);
			const readable = authorizables
				.filter((authorizable) => this.boardNodeRule.can('findBoard', session.principal.user, authorizable))
				.map((authorizable) => authorizable.boardNode as ColumnBoard);

			return readable.sort(byCreation);
		});
	}
}
