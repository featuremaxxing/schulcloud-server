import { BoardNode } from './board-node.do';
import type { AnyBoardNode, FileAreaFolderProps } from './types';

// A folder inside a board with layout FILES. Folders can be nested to any depth;
// files are file records in files-storage whose parent is the folder (or the board itself).
export class FileAreaFolder extends BoardNode<FileAreaFolderProps> {
	get title(): string {
		return this.props.title || '';
	}

	set title(value: string) {
		this.props.title = value;
	}

	public canHaveChild(childNode: AnyBoardNode): boolean {
		return childNode instanceof FileAreaFolder;
	}
}

export const isFileAreaFolder = (reference: unknown): reference is FileAreaFolder =>
	reference instanceof FileAreaFolder;
