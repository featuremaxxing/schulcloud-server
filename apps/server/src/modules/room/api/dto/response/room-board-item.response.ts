import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoomBoardLockResponse {
	@ApiProperty({ description: 'The learning path that locks the board.' })
	id: string;

	@ApiProperty()
	title: string;

	constructor(props: RoomBoardLockResponse) {
		this.id = props.id;
		this.title = props.title;
	}
}
import { BoardLayout } from '@modules/board';

export class RoomLearningPathStepResponse {
	@ApiProperty()
	id: string;

	@ApiProperty({ description: 'The board the step links to.' })
	boardId: string;

	@ApiProperty({ description: 'Empty when the board is not available to the user.' })
	title: string;

	@ApiProperty()
	isVisible: boolean;

	@ApiProperty({ enum: ['done', 'open', 'locked', 'unavailable'] })
	status: 'done' | 'open' | 'locked' | 'unavailable';

	@ApiProperty({ type: [String] })
	prerequisiteStepIds: string[];

	@ApiProperty()
	positionX: number;

	@ApiProperty()
	positionY: number;

	constructor(props: RoomLearningPathStepResponse) {
		this.id = props.id;
		this.boardId = props.boardId;
		this.title = props.title;
		this.isVisible = props.isVisible;
		this.status = props.status;
		this.prerequisiteStepIds = props.prerequisiteStepIds;
		this.positionX = props.positionX;
		this.positionY = props.positionY;
	}
}

export class RoomLearningPathResponse {
	@ApiProperty({ type: [RoomLearningPathStepResponse] })
	steps: RoomLearningPathStepResponse[];

	@ApiPropertyOptional({ description: 'Only for editors: the students of the room.' })
	studentCount?: number;

	@ApiPropertyOptional({ description: 'Only for editors: the students who completed every published board.' })
	completedStudentCount?: number;

	constructor(props: RoomLearningPathResponse) {
		this.steps = props.steps;
		this.studentCount = props.studentCount;
		this.completedStudentCount = props.completedStudentCount;
	}
}
import { BoardOperation, BoardOperationValues } from '@modules/board/authorisation/board-node.rule';

export class RoomBoardItemResponse {
	@ApiProperty()
	id: string;

	@ApiProperty()
	title: string;

	@ApiProperty({ enum: BoardLayout, enumName: 'BoardLayout' })
	layout: BoardLayout;

	@ApiProperty({ type: Boolean })
	isVisible: boolean;

	@ApiProperty({ type: Date })
	createdAt: Date;

	@ApiProperty({ type: Date })
	updatedAt: Date;

	@ApiProperty({
		type: 'object',
		properties: BoardOperationValues.reduce((acc, op) => {
			acc[op] = { type: 'boolean' };
			return acc;
		}, {}),
		additionalProperties: false,
	})
	allowedOperations: Partial<Record<BoardOperation, boolean>>;

	@ApiPropertyOptional({
		type: RoomBoardLockResponse,
		description: 'Set when a learning path keeps the board closed until other boards are completed.',
	})
	lockedByLearningPath?: RoomBoardLockResponse;

	@ApiPropertyOptional({
		type: RoomLearningPathResponse,
		description: 'For learning paths: their boards with the state of the user.',
	})
	learningPath?: RoomLearningPathResponse;

	constructor(item: RoomBoardItemResponse) {
		this.id = item.id;
		this.title = item.title;
		this.layout = item.layout;
		this.isVisible = item.isVisible;
		this.createdAt = item.createdAt;
		this.updatedAt = item.updatedAt;
		this.allowedOperations = item.allowedOperations;
		this.lockedByLearningPath = item.lockedByLearningPath;
		this.learningPath = item.learningPath;
	}
}
