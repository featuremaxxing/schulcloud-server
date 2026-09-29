import { type EntityId } from '@shared/domain/types';
import {
	BoardExternalReferenceType,
	type Card,
	type Column,
	type ColumnBoard,
	type FileAreaFolder,
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

// a folder inside a file area (a board with layout FILES); its subfolders and files sit directly below it
export interface AreaFolderResource extends ResourceBase {
	kind: 'areaFolder';
	context: WebDavContext;
	board: ColumnBoard;
	folder: FileAreaFolder;
}

// a file directly in a file area or in one of its folders; parentId is the board or folder the file belongs to
export interface AreaFileResource extends ResourceBase {
	kind: 'areaFile';
	context: WebDavContext;
	board: ColumnBoard;
	parentId: EntityId;
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
	| AreaFolderResource
	| FileResource
	| AreaFileResource;

export type AnyFileResource = FileResource | AreaFileResource;

export type WebDavCollection = Exclude<WebDavResource, AnyFileResource>;

export const isCollection = (resource: WebDavResource): resource is WebDavCollection =>
	resource.kind !== 'file' && resource.kind !== 'areaFile';

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
