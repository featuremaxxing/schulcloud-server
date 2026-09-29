import type { EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { FileAreaLinkElementProps, FileAreaLinkTargetType } from './types';

export class FileAreaLinkElement extends BoardNode<FileAreaLinkElementProps> {
	get fileAreaId(): EntityId | undefined {
		return this.props.fileAreaId;
	}

	get targetType(): FileAreaLinkTargetType | undefined {
		return this.props.targetType;
	}

	get targetId(): EntityId | undefined {
		return this.props.targetId;
	}

	get title(): string {
		return this.props.title || '';
	}

	set title(value: string) {
		this.props.title = value;
	}

	public setTarget(target: {
		fileAreaId: EntityId;
		targetType: FileAreaLinkTargetType;
		targetId: EntityId;
		title: string;
	}): void {
		this.props.fileAreaId = target.fileAreaId;
		this.props.targetType = target.targetType;
		this.props.targetId = target.targetId;
		this.props.title = target.title;
	}

	public clearTarget(): void {
		this.props.fileAreaId = undefined;
		this.props.targetType = undefined;
		this.props.targetId = undefined;
	}

	public canHaveChild(): boolean {
		return false;
	}
}

export const isFileAreaLinkElement = (reference: unknown): reference is FileAreaLinkElement =>
	reference instanceof FileAreaLinkElement;
