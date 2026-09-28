import { CourseService } from '@modules/course';
import { RoomService } from '@modules/room';
import { RoomMembershipService } from '@modules/room-membership';
import { Injectable } from '@nestjs/common';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import {
	AnyBoardNode,
	BoardExternalReferenceType,
	Card,
	ColumnBoard,
	FileElement,
	FileFolderElement,
	isCard,
	isColumn,
	isFileElement,
	isFileFolderElement,
} from '../domain';
import { BoardNodeAuthorizableService, ColumnBoardService } from '../service';
import { assignUniqueNames, sanitizeName } from './webdav-names';
import { WebDavFileRecord, WebDavFilesStorageClient } from './webdav-files-storage.client';
import {
	BoardResource,
	CONTEXT_LIST_NAMES,
	FALLBACK_NAMES,
	isCollection,
	WebDavCollection,
	WebDavContext,
	WebDavResource,
} from './webdav-resource';
import { WebDavSession } from './webdav-session';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ChildWithoutSegments = DistributiveOmit<WebDavResource, 'segments'> & { name: string };

// how an entry of a card is shown: a folder element as a directory, a file element as its file
type UnnamedCardEntry =
	{ type: 'folder'; element: FileFolderElement } | { type: 'file'; element: FileElement; fileRecord: WebDavFileRecord };
type CardEntry = UnnamedCardEntry & { name: string };

const CONTEXT_TYPES: WebDavContext['type'][] = [BoardExternalReferenceType.Course, BoardExternalReferenceType.Room];

const byCreation = (a: { createdAt?: Date; id: string }, b: { createdAt?: Date; id: string }): number =>
	(a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id);

/**
 * Maps the boards a user can see onto a directory tree:
 *
 *   /Kurse/<course>/<board>/<column>/<card>/<file>
 *   /Kurse/<course>/<board>/<column>/<card>/<folder element>/<file>
 *   /Räume/<room>/<board>/...
 *
 * Names are derived from titles on every request (there is no stored mapping), so the
 * order in which siblings are listed decides which duplicate gets the " (2)" suffix. That
 * order is the board order for columns, cards and elements and the creation order above.
 */
@Injectable()
export class WebDavResourceResolver {
	constructor(
		private readonly courseService: CourseService,
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

	public getFiles(session: WebDavSession, context: WebDavContext, elementId: string): Promise<WebDavFileRecord[]> {
		return session.memoize(session.files, elementId, async () => {
			const jwt = await session.principal.getFilesStorageJwt();
			const files = await this.filesStorageClient.list(jwt, context.schoolId, elementId);

			return files.sort(byCreation);
		});
	}

	private async loadChildren(session: WebDavSession, collection: WebDavCollection): Promise<ChildWithoutSegments[]> {
		switch (collection.kind) {
			case 'root':
				return CONTEXT_TYPES.map((contextType) => {
					return {
						kind: 'contextList' as const,
						contextType,
						name: CONTEXT_LIST_NAMES[contextType],
					};
				});
			case 'contextList': {
				const contexts = await this.getContexts(session, collection.contextType);

				return assignUniqueNames(
					contexts,
					(context) => sanitizeName(context.name, FALLBACK_NAMES.context),
					() => false
				).map(({ entry, name }) => {
					return { kind: 'context' as const, context: entry, name };
				});
			}
			case 'context': {
				const boards = await this.getReadableBoards(session, collection.context);

				return assignUniqueNames(
					boards,
					(board) => sanitizeName(board.title, FALLBACK_NAMES.board),
					() => false
				).map(({ entry, name }) => {
					return { kind: 'board' as const, context: collection.context, board: entry, name };
				});
			}
			case 'board':
				return this.loadColumns(session, collection);
			case 'column': {
				const cards = collection.column.children.filter((child): child is Card => isCard(child));

				return assignUniqueNames(
					cards,
					(card) => sanitizeName(card.title, FALLBACK_NAMES.card),
					() => false
				).map(({ entry, name }) => {
					return {
						kind: 'card' as const,
						context: collection.context,
						board: collection.board,
						column: collection.column,
						card: entry,
						name,
					};
				});
			}
			case 'card': {
				const entries = await this.getCardEntries(session, collection.context, collection.card);

				return entries.map((entry) =>
					entry.type === 'folder'
						? {
								kind: 'folder' as const,
								context: collection.context,
								board: collection.board,
								card: collection.card,
								element: entry.element,
								name: entry.name,
							}
						: {
								kind: 'file' as const,
								context: collection.context,
								board: collection.board,
								card: collection.card,
								element: entry.element,
								fileRecord: entry.fileRecord,
								name: entry.name,
							}
				);
			}
			case 'folder': {
				const files = await this.getFiles(session, collection.context, collection.element.id);

				return assignUniqueNames(
					files,
					(file) => sanitizeName(file.name, FALLBACK_NAMES.file),
					() => true
				).map(({ entry, name }) => {
					return {
						kind: 'file' as const,
						context: collection.context,
						board: collection.board,
						card: collection.card,
						element: collection.element,
						fileRecord: entry,
						name,
					};
				});
			}
			default:
				return [];
		}
	}

	private async loadColumns(session: WebDavSession, collection: BoardResource): Promise<ChildWithoutSegments[]> {
		const board = await this.getBoardTree(session, collection.board.id);
		const columns = board.children.filter(isColumn);

		return assignUniqueNames(
			columns,
			(column) => sanitizeName(column.title, FALLBACK_NAMES.column),
			() => false
		).map(({ entry, name }) => {
			return {
				kind: 'column' as const,
				context: collection.context,
				board,
				column: entry,
				name,
			};
		});
	}

	private async getCardEntries(session: WebDavSession, context: WebDavContext, card: Card): Promise<CardEntry[]> {
		const elements = card.children.filter(
			(child: AnyBoardNode): child is FileElement | FileFolderElement =>
				isFileElement(child) || isFileFolderElement(child)
		);

		const entriesPerElement = await Promise.all(
			elements.map(async (element): Promise<UnnamedCardEntry[]> => {
				if (isFileFolderElement(element)) {
					return [{ type: 'folder', element }];
				}
				// a file element holds a single file; an element without one (upload not
				// finished or aborted) does not show up at all
				const files = await this.getFiles(session, context, element.id);

				return files.map((fileRecord): UnnamedCardEntry => {
					return { type: 'file', element, fileRecord };
				});
			})
		);

		return assignUniqueNames(
			entriesPerElement.flat(),
			(entry) =>
				entry.type === 'folder'
					? sanitizeName(entry.element.title, FALLBACK_NAMES.folder)
					: sanitizeName(entry.fileRecord.name, FALLBACK_NAMES.file),
			(entry) => entry.type === 'file'
		).map(({ entry, name }): CardEntry => {
			return { ...entry, name };
		});
	}

	private getContexts(session: WebDavSession, contextType: WebDavContext['type']): Promise<WebDavContext[]> {
		return session.memoize(session.contexts, contextType, async () => {
			const contexts =
				contextType === BoardExternalReferenceType.Course
					? await this.getCourseContexts(session)
					: await this.getRoomContexts(session);

			return contexts.sort(byCreation);
		});
	}

	private async getCourseContexts(session: WebDavSession): Promise<WebDavContext[]> {
		const { user } = session.principal;
		const [courses] = await this.courseService.findAllByUserId(user.id, user.school.id, { onlyActiveCourses: true });

		return courses.map((course) => {
			return {
				type: BoardExternalReferenceType.Course,
				id: course.id,
				name: course.name,
				schoolId: course.school.id,
				createdAt: course.createdAt,
				updatedAt: course.updatedAt,
			};
		});
	}

	private async getRoomContexts(session: WebDavSession): Promise<WebDavContext[]> {
		const roomAuthorizables = await this.roomMembershipService.getRoomAuthorizablesByUserId(session.userId);
		const rooms = await this.roomService.getRoomsByIds(roomAuthorizables.map((authorizable) => authorizable.roomId));

		return rooms.map((room) => {
			return {
				type: BoardExternalReferenceType.Room,
				id: room.id,
				name: room.name,
				schoolId: room.schoolId,
				createdAt: room.createdAt,
				updatedAt: room.updatedAt,
			};
		});
	}

	private getReadableBoards(session: WebDavSession, context: WebDavContext): Promise<ColumnBoard[]> {
		return session.memoize(session.boardsOfContext, context.id, async () => {
			const boards = await this.columnBoardService.findByExternalReference({ type: context.type, id: context.id }, 0);
			if (boards.length === 0) {
				return [];
			}

			const authorizables = await this.boardNodeAuthorizableService.getBoardAuthorizables(boards);
			const readableBoards = authorizables
				.filter((authorizable) => this.boardNodeRule.can('findBoard', session.principal.user, authorizable))
				.map((authorizable) => authorizable.boardNode as ColumnBoard);

			return readableBoards.sort(byCreation);
		});
	}
}
