import { BoardNode } from './board-node.do';
import { Column } from './column.do';
import { FileAreaFolder } from './file-area-folder.do';
import { type AnyBoardNode, type BoardExternalReference, BoardLayout, type ColumnBoardProps } from './types';

export class ColumnBoard extends BoardNode<ColumnBoardProps> {
	get title(): string {
		return this.props.title;
	}

	set title(title: string) {
		this.props.title = title;
	}

	get context(): BoardExternalReference {
		return this.props.context;
	}

	set context(context: BoardExternalReference) {
		this.props.context = context;
	}

	get isVisible(): boolean {
		return this.props.isVisible;
	}

	set isVisible(isVisible: boolean) {
		if (!isVisible) {
			this.props.readersCanEdit = false;
		}
		this.props.isVisible = isVisible;
	}

	get layout(): BoardLayout {
		return this.props.layout;
	}

	set layout(layout: BoardLayout) {
		this.props.layout = layout;
	}

	get readersCanEdit(): boolean {
		return this.props.readersCanEdit;
	}

	set readersCanEdit(readersCanEdit: boolean) {
		this.props.readersCanEdit = readersCanEdit;
	}

	public isFileArea(): boolean {
		return this.props.layout === BoardLayout.FILES;
	}

	public canHaveChild(childNode: AnyBoardNode): boolean {
		if (this.isFileArea()) {
			return childNode instanceof FileAreaFolder;
		}
		const allowed = childNode instanceof Column;
		return allowed;
	}
}

export const isColumnBoard = (reference: unknown): reference is ColumnBoard => reference instanceof ColumnBoard;
