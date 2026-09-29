import { ApiProperty } from '@nestjs/swagger';
import { type BoardOperation, BoardOperationValues } from '../../../authorisation/board-node.rule';

export class FileAreaFolderResponse {
	@ApiProperty()
	id: string;

	@ApiProperty({ description: 'The id of the parent: the file area board or another folder.' })
	parentId: string;

	@ApiProperty()
	title: string;

	@ApiProperty()
	createdAt: Date;

	@ApiProperty()
	updatedAt: Date;

	constructor(props: FileAreaFolderResponse) {
		this.id = props.id;
		this.parentId = props.parentId;
		this.title = props.title;
		this.createdAt = props.createdAt;
		this.updatedAt = props.updatedAt;
	}
}

export class FileAreaFoldersResponse {
	@ApiProperty()
	boardId: string;

	@ApiProperty({ type: [FileAreaFolderResponse], description: 'All folders of the board as a flat list.' })
	folders: FileAreaFolderResponse[];

	@ApiProperty({
		type: 'object',
		properties: BoardOperationValues.reduce((acc, op) => {
			acc[op] = { type: 'boolean' };
			return acc;
		}, {}),
		additionalProperties: false,
		required: [...BoardOperationValues],
	})
	allowedOperations: Record<BoardOperation, boolean>;

	constructor(props: FileAreaFoldersResponse) {
		this.boardId = props.boardId;
		this.folders = props.folders;
		this.allowedOperations = props.allowedOperations;
	}
}
