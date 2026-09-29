import { type EntityId } from '@shared/domain/types';
import {
	BoardExternalReferenceType,
	type Card,
	type Column,
	type ColumnBoard,
	type FileElement,
	type FileFolderElement,
} from '../domain';
import { type WebDavFileRecord } from './webdav-files-storage.client';

export interface WebDavContext {
	type: BoardExternalReferenceType.Course | BoardExternalReferenceType.Room;
	id: EntityId;
	name: string;
	// storage location of all files in boards of this context
	schoolId: EntityId;
	createdAt?: Date;
	updatedAt?: Date;
}

interface ResourceBase {
	// decoded path segments from the drive root, as the client sees them
	segments: string[];
}

export interface RootResource extends ResourceBase {
	kind: 'root';
}

export interface ContextListResource extends ResourceBase {
	kind: 'contextList';
	contextType: WebDavContext['type'];
}

export interface ContextResource extends ResourceBase {
	kind: 'context';
	context: WebDavContext;
}

export interface BoardResource extends ResourceBase {
	kind: 'board';
	context: WebDavContext;
	board: ColumnBoard;
}

export interface ColumnResource extends ResourceBase {
	kind: 'column';
	context: WebDavContext;
	board: ColumnBoard;
	column: Column;
}

export interface CardResource extends ResourceBase {
	kind: 'card';
	context: WebDavContext;
	board: ColumnBoard;
	column: Column;
	card: Card;
}

export interface FolderResource extends ResourceBase {
	kind: 'folder';
	context: WebDavContext;
	board: ColumnBoard;
	card: Card;
	element: FileFolderElement;
}

export interface FileResource extends ResourceBase {
	kind: 'file';
	context: WebDavContext;
	board: ColumnBoard;
	card: Card;
	// a file element (holding exactly this file) directly in the card, or a folder element
	element: FileElement | FileFolderElement;
	fileRecord: WebDavFileRecord;
}

export type WebDavResource =
	| RootResource
	| ContextListResource
	| ContextResource
	| BoardResource
	| ColumnResource
	| CardResource
	| FolderResource
	| FileResource;

export type WebDavCollection = Exclude<WebDavResource, FileResource>;

export const isCollection = (resource: WebDavResource): resource is WebDavCollection => resource.kind !== 'file';

// display names of the two top level folders
export const CONTEXT_LIST_NAMES: Record<WebDavContext['type'], string> = {
	[BoardExternalReferenceType.Course]: 'Kurse',
	[BoardExternalReferenceType.Room]: 'Räume',
};

export const FALLBACK_NAMES = {
	context: 'Ohne Namen',
	board: 'Unbenanntes Board',
	column: 'Unbenannter Abschnitt',
	card: 'Unbenannte Karte',
	folder: 'Ordner',
	file: 'Datei',
};
