import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { LearningPathStepStatus } from '../../../service';

const STEP_STATUSES: LearningPathStepStatus[] = ['done', 'open', 'locked', 'unavailable'];

export class LearningPathStepResponse {
	@ApiProperty()
	id: string;

	@ApiProperty({ description: 'The board the step leads to.' })
	linkedBoardId: string;

	@ApiProperty({ description: 'Title of the linked board, empty when it is not available to the user.' })
	title: string;

	@ApiProperty({ description: 'Whether the linked board is published.' })
	isVisible: boolean;

	@ApiProperty()
	positionX: number;

	@ApiProperty()
	positionY: number;

	@ApiProperty({ type: [String], description: 'The steps that lead to this one.' })
	prerequisiteStepIds: string[];

	@ApiProperty({ enum: ['all', 'any'], enumName: 'LearningPathUnlockMode' })
	unlockMode: 'all' | 'any';

	@ApiProperty()
	lockUntilPrerequisitesDone: boolean;

	@ApiProperty({ enum: STEP_STATUSES, enumName: 'LearningPathStepStatus' })
	status: LearningPathStepStatus;

	@ApiPropertyOptional({ description: 'Editors only: students who completed the board.' })
	doneCount?: number;

	@ApiPropertyOptional({ description: 'Editors only: students of the room.' })
	studentCount?: number;

	constructor(props: LearningPathStepResponse) {
		this.id = props.id;
		this.linkedBoardId = props.linkedBoardId;
		this.title = props.title;
		this.isVisible = props.isVisible;
		this.positionX = props.positionX;
		this.positionY = props.positionY;
		this.prerequisiteStepIds = props.prerequisiteStepIds;
		this.unlockMode = props.unlockMode;
		this.lockUntilPrerequisitesDone = props.lockUntilPrerequisitesDone;
		this.status = props.status;
		this.doneCount = props.doneCount;
		this.studentCount = props.studentCount;
	}
}

export class LearningPathAvailableBoardResponse {
	@ApiProperty()
	id: string;

	@ApiProperty()
	title: string;

	@ApiProperty()
	isVisible: boolean;

	constructor(props: LearningPathAvailableBoardResponse) {
		this.id = props.id;
		this.title = props.title;
		this.isVisible = props.isVisible;
	}
}

export class LearningPathResponse {
	@ApiProperty()
	boardId: string;

	@ApiProperty({ description: 'Whether the user may change the learning path.' })
	isEditor: boolean;

	@ApiProperty({ type: [LearningPathStepResponse] })
	steps: LearningPathStepResponse[];

	@ApiProperty({
		type: [LearningPathAvailableBoardResponse],
		description: 'Editors only: the boards of the room that can be added.',
	})
	availableBoards: LearningPathAvailableBoardResponse[];

	constructor(props: LearningPathResponse) {
		this.boardId = props.boardId;
		this.isEditor = props.isEditor;
		this.steps = props.steps;
		this.availableBoards = props.availableBoards;
	}
}

export class BoardCompletionResponse {
	@ApiProperty({ description: 'Whether the board is part of a published learning path.' })
	inLearningPath: boolean;

	@ApiProperty({ description: 'Whether the user marks the board as done by hand (it has no progress items).' })
	canMarkManually: boolean;

	@ApiProperty()
	completed: boolean;

	constructor(props: BoardCompletionResponse) {
		this.inLearningPath = props.inLearningPath;
		this.canMarkManually = props.canMarkManually;
		this.completed = props.completed;
	}
}
