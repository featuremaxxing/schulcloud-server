import { AuthorizationService } from '@modules/authorization';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule, BoardOperation } from '../authorisation/board-node.rule';
import {
	AnyBoardNode,
	BoardNodeFactory,
	ColumnBoard,
	FileAreaFolder,
	isColumnBoard,
	isFileAreaFolder,
} from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService, FileAreaNotifier } from '../service';
import { sanitizeName } from '../webdav/webdav-names';

@Injectable()
export class FileAreaUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly fileAreaNotifier: FileAreaNotifier
	) {}

	public async listFolders(
		userId: EntityId,
		boardId: EntityId
	): Promise<{
		board: ColumnBoard;
		folders: FileAreaFolder[];
		allowedOperations: Record<BoardOperation, boolean>;
	}> {
		const board = await this.findFileArea(boardId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);

		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, boardNodeAuthorizable));

		const folders = this.collectFolders(board);
		const allowedOperations = this.boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);

		return { board, folders, allowedOperations };
	}

	public async createFolder(userId: EntityId, parentId: EntityId, title: string): Promise<FileAreaFolder> {
		const parent = await this.findContainer(parentId);
		await this.checkPermission(userId, parent, 'createElement');

		const folder = this.boardNodeFactory.buildFileAreaFolder(this.uniqueTitle(parent, title));
		await this.boardNodeService.addToParent(parent, folder);
		this.fileAreaNotifier.foldersChanged(parent.rootId, [parent.id]);

		return folder;
	}

	public async renameFolder(userId: EntityId, folderId: EntityId, title: string): Promise<FileAreaFolder> {
		const folder = await this.findFolder(folderId);
		await this.checkPermission(userId, folder, 'updateElement');

		const parent = await this.findContainer(folder.parentId);
		await this.boardNodeService.updateTitle(folder, this.uniqueTitle(parent, title, folder));
		this.fileAreaNotifier.foldersChanged(folder.rootId, [parent.id]);

		return folder;
	}

	public async moveFolder(userId: EntityId, folderId: EntityId, toParentId: EntityId): Promise<FileAreaFolder> {
		const folder = await this.findFolder(folderId);
		const toParent = await this.findContainer(toParentId);

		if (toParent.rootId !== folder.rootId) {
			throw new BadRequestException('Folders can only be moved within the same file area');
		}
		// a folder must not end up inside itself or one of its own descendants
		if (toParent.id === folder.id || toParent.path.includes(folder.id)) {
			throw new BadRequestException('A folder cannot be moved into itself');
		}

		await this.checkPermission(userId, folder, 'moveElement');

		const fromParent = await this.findContainer(folder.parentId);
		if (fromParent.id !== toParent.id) {
			folder.title = this.uniqueTitle(toParent, folder.title, folder);
			await this.boardNodeService.move(folder, toParent);
			await this.boardNodeService.save(folder);
			this.fileAreaNotifier.foldersChanged(folder.rootId, [fromParent.id, toParent.id]);
		}

		return folder;
	}

	public async deleteFolder(userId: EntityId, folderId: EntityId): Promise<{ boardId: EntityId; parentId: EntityId }> {
		const folder = await this.findFolder(folderId);
		await this.checkPermission(userId, folder, 'deleteElement');

		const result = { boardId: folder.rootId, parentId: folder.parentId as EntityId };
		await this.boardNodeService.delete(folder);
		this.fileAreaNotifier.foldersChanged(result.boardId, [result.parentId]);

		return result;
	}

	// Files are uploaded, renamed, moved and deleted directly in the file storage, so the client
	// reports them here once they are done.
	public async notifyFilesChanged(userId: EntityId, boardId: EntityId, parentIds: EntityId[]): Promise<void> {
		const board = await this.findFileArea(boardId);
		await this.checkPermission(userId, board, 'createFileElement');

		const parents = await this.boardNodeService.findByIds(parentIds, 0);
		const uniqueIds = new Set(parentIds);
		if (parents.length !== uniqueIds.size || !parents.every((parent) => parent.rootId === board.id)) {
			throw new BadRequestException('The parents must belong to this file area');
		}

		this.fileAreaNotifier.filesChanged(board.id, parentIds);
	}

	private async findFileArea(boardId: EntityId): Promise<ColumnBoard> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		if (!board.isFileArea()) {
			throw new NotFoundException('The board is not a file area');
		}

		return board;
	}

	private async findFolder(folderId: EntityId): Promise<FileAreaFolder> {
		const folder = await this.boardNodeService.findByClassAndId(FileAreaFolder, folderId);
		if (!folder.parentId) {
			throw new NotFoundException('Folder has no parent');
		}

		return folder;
	}

	// the parent of a folder is either the file area board or another folder
	private async findContainer(id: EntityId | undefined): Promise<ColumnBoard | FileAreaFolder> {
		if (!id) {
			throw new NotFoundException('Parent not found');
		}
		const node = await this.boardNodeService.findById(id);
		if (isFileAreaFolder(node) || (isColumnBoard(node) && node.isFileArea())) {
			return node;
		}

		throw new BadRequestException('The parent must be a file area or a folder of a file area');
	}

	private async checkPermission(userId: EntityId, node: AnyBoardNode, operation: BoardOperation): Promise<void> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(node);

		throwForbiddenIfFalse(this.boardNodeRule.can(operation, user, boardNodeAuthorizable));
	}

	private collectFolders(node: AnyBoardNode): FileAreaFolder[] {
		return node.children.flatMap((child) => (isFileAreaFolder(child) ? [child, ...this.collectFolders(child)] : []));
	}

	// folder names become file system names in the WebDAV drive, so keep them valid and unique among siblings
	private uniqueTitle(parent: AnyBoardNode, title: string, except?: FileAreaFolder): string {
		const taken = new Set(
			parent.children
				.filter((child): child is FileAreaFolder => isFileAreaFolder(child) && child.id !== except?.id)
				.map((child) => child.title.toLowerCase())
		);
		const base = sanitizeName(title, 'Ordner');

		let name = base;
		for (let counter = 2; taken.has(name.toLowerCase()); counter += 1) {
			name = `${base} (${counter})`;
		}

		return name;
	}
}
