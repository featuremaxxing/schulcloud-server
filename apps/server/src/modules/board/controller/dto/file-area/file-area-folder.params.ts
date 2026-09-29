import { ApiProperty } from '@nestjs/swagger';
import { SanitizeHtml } from '@shared/controller/transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, MaxLength, MinLength } from 'class-validator';

export class FileAreaFolderUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the folder.', required: true, nullable: false })
	folderId!: string;
}

export class FileAreaBoardUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the file area board.', required: true, nullable: false })
	boardId!: string;
}

export class FileAreaRoomUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the room.', required: true, nullable: false })
	roomId!: string;
}

export class CreateFileAreaFolderBodyParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the parent: the file area board or another folder.', required: true })
	parentId!: string;

	@MinLength(1)
	@MaxLength(100)
	@SanitizeHtml()
	@ApiProperty({ description: 'The name of the folder.', required: true })
	title!: string;
}

export class RenameFileAreaFolderBodyParams {
	@MinLength(1)
	@MaxLength(100)
	@SanitizeHtml()
	@ApiProperty({ description: 'The new name of the folder.', required: true })
	title!: string;
}

export class MoveFileAreaFolderBodyParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the new parent: the file area board or another folder.', required: true })
	toParentId!: string;
}

export class FileAreaFilesChangedBodyParams {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(10)
	@IsMongoId({ each: true })
	@ApiProperty({
		description: 'The ids of the folders (or of the file area itself) whose files changed.',
		type: [String],
		required: true,
	})
	parentIds!: string[];
}
