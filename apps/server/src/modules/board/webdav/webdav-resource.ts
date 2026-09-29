import { type EntityId } from '@shared/domain/types';
import { type ColumnBoard, type FileAreaFolder } from '../domain';
import { type WebDavFileRecord } from './webdav-files-storage.client';

// a room with at least one file area the user can read
export interface WebDavContext {
	id: EntityId;
	name: string;
	// storage location of all files in boards of this room
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

export interface ContextResource extends ResourceBase {
	kind: 'context';
	context: WebDavContext;
}

// a file area (a board with layout FILES)
export interface BoardResource extends ResourceBase {
	kind: 'board';
	context: WebDavContext;
	board: ColumnBoard;
}

// a folder inside a file area; its subfolders and files sit directly below it
export interface FolderResource extends ResourceBase {
	kind: 'folder';
	context: WebDavContext;
	board: ColumnBoard;
	folder: FileAreaFolder;
}

// a file directly in a file area or in one of its folders; parentId is the board or folder the file belongs to
export interface FileResource extends ResourceBase {
	kind: 'file';
	context: WebDavContext;
	board: ColumnBoard;
	parentId: EntityId;
	fileRecord: WebDavFileRecord;
}

export type WebDavResource = RootResource | ContextResource | BoardResource | FolderResource | FileResource;

export type WebDavCollection = Exclude<WebDavResource, FileResource>;

// where files and folders can be stored: the file area itself or one of its folders
export type WebDavContainer = BoardResource | FolderResource;

export const isCollection = (resource: WebDavResource): resource is WebDavCollection => resource.kind !== 'file';

export const isContainer = (resource: WebDavResource): resource is WebDavContainer =>
	resource.kind === 'board' || resource.kind === 'folder';

// the id files of a container (or the parent of a file) are attached to in the file storage
export const storageParentIdOf = (resource: WebDavContainer | FileResource): EntityId => {
	switch (resource.kind) {
		case 'folder':
			return resource.folder.id;
		case 'file':
			return resource.parentId;
		default:
			return resource.board.id;
	}
};

export const FALLBACK_NAMES = {
	context: 'Ohne Namen',
	board: 'Unbenannter Datei-Bereich',
	folder: 'Ordner',
	file: 'Datei',
};
