import { CurrentUser, ICurrentUser, JwtAuthentication } from '@infra/auth-guard';
import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Patch,
	Post,
	Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiValidationError } from '@shared/common/error';
import { FileAreaUc } from '../uc';
import {
	CreateFileAreaFolderBodyParams,
	FileAreaFilesChangedBodyParams,
	FileAreaBoardUrlParams,
	FileAreaFolderResponse,
	FileAreaFolderUrlParams,
	FileAreaFoldersResponse,
	MoveFileAreaFolderBodyParams,
	RenameFileAreaFolderBodyParams,
} from './dto';
import { FileAreaFolder } from '../domain';

const toResponse = (folder: FileAreaFolder): FileAreaFolderResponse =>
	new FileAreaFolderResponse({
		id: folder.id,
		parentId: folder.parentId as string,
		title: folder.title,
		createdAt: folder.createdAt,
		updatedAt: folder.updatedAt,
	});

@ApiTags('Board File Area')
@JwtAuthentication()
@Controller()
export class FileAreaController {
	constructor(private readonly fileAreaUc: FileAreaUc) {}

	@ApiOperation({ summary: 'List all folders of a file area as a flat list.' })
	@ApiResponse({ status: 200, type: FileAreaFoldersResponse })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Get('boards/:boardId/file-area/folders')
	public async listFolders(
		@Param() urlParams: FileAreaBoardUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<FileAreaFoldersResponse> {
		const { board, folders, allowedOperations } = await this.fileAreaUc.listFolders(
			currentUser.userId,
			urlParams.boardId
		);

		return new FileAreaFoldersResponse({ boardId: board.id, folders: folders.map(toResponse), allowedOperations });
	}

	@ApiOperation({ summary: 'Tell everybody who has the file area open that files of some folders changed.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Post('boards/:boardId/file-area/files-changed')
	public async filesChanged(
		@Param() urlParams: FileAreaBoardUrlParams,
		@Body() bodyParams: FileAreaFilesChangedBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.fileAreaUc.notifyFilesChanged(currentUser.userId, urlParams.boardId, bodyParams.parentIds);
	}

	@ApiOperation({ summary: 'Create a folder in a file area or in another folder.' })
	@ApiResponse({ status: 201, type: FileAreaFolderResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Post('file-area-folders')
	public async createFolder(
		@Body() bodyParams: CreateFileAreaFolderBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<FileAreaFolderResponse> {
		const folder = await this.fileAreaUc.createFolder(currentUser.userId, bodyParams.parentId, bodyParams.title);

		return toResponse(folder);
	}

	@ApiOperation({ summary: 'Rename a folder.' })
	@ApiResponse({ status: 200, type: FileAreaFolderResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Patch('file-area-folders/:folderId/title')
	public async renameFolder(
		@Param() urlParams: FileAreaFolderUrlParams,
		@Body() bodyParams: RenameFileAreaFolderBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<FileAreaFolderResponse> {
		const folder = await this.fileAreaUc.renameFolder(currentUser.userId, urlParams.folderId, bodyParams.title);

		return toResponse(folder);
	}

	@ApiOperation({ summary: 'Move a folder to another folder or to the top level of the file area.' })
	@ApiResponse({ status: 200, type: FileAreaFolderResponse })
	@ApiResponse({ status: 400, type: ApiValidationError })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@Put('file-area-folders/:folderId/parent')
	public async moveFolder(
		@Param() urlParams: FileAreaFolderUrlParams,
		@Body() bodyParams: MoveFileAreaFolderBodyParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<FileAreaFolderResponse> {
		const folder = await this.fileAreaUc.moveFolder(currentUser.userId, urlParams.folderId, bodyParams.toParentId);

		return toResponse(folder);
	}

	@ApiOperation({ summary: 'Delete a folder with all subfolders and files.' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 403, type: ForbiddenException })
	@ApiResponse({ status: 404, type: NotFoundException })
	@HttpCode(204)
	@Delete('file-area-folders/:folderId')
	public async deleteFolder(
		@Param() urlParams: FileAreaFolderUrlParams,
		@CurrentUser() currentUser: ICurrentUser
	): Promise<void> {
		await this.fileAreaUc.deleteFolder(currentUser.userId, urlParams.folderId);
	}
}
