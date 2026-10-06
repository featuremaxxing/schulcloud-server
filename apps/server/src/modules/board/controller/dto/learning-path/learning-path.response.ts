import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LearningPathColor } from '../../../domain';
import type { LearningPathLockReason, LearningPathStepStatus } from '../../../service';

const STEP_STATUSES: LearningPathStepStatus[] = ['done', 'open', 'locked', 'unavailable'];

export class LearningPathLockResponse {
	@ApiProperty({ description: 'The learning path that keeps the board closed.' })
	pathId: string;

	@ApiProperty()
	pathTitle: string;

	@ApiProperty({ enum: ['prerequisites', 'chooseLearningPath'], enumName: 'LearningPathLockReason' })
	reason: LearningPathLockReason;

	constructor(props: LearningPathLockResponse) {
		this.pathId = props.pathId;
		this.pathTitle = props.pathTitle;
		this.reason = props.reason;
	}
}

export class LearningPathStepResponse {
	@ApiProperty()
	id: string;

	@ApiProperty({ description: 'The board the step leads to - for a card step the board the card lies on.' })
	linkedBoardId: string;

	@ApiPropertyOptional({ description: 'Card steps: the card the step leads to.' })
	linkedCardId?: string;

	@ApiProperty({ description: 'Title of the linked board or card, empty when it is not available to the user.' })
	title: string;

	@ApiPropertyOptional({ description: 'Card steps: title of the board the card lies on.' })
	boardTitle?: string;

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

	@ApiPropertyOptional({
		description:
			'Students only: the board was completed before, but something new came up. It still unlocks what follows.',
	})
	reopened?: boolean;

	@ApiPropertyOptional({
		type: LearningPathLockResponse,
		description: 'Students only: what keeps a locked step closed.',
	})
	lock?: LearningPathLockResponse;

	@ApiPropertyOptional({ description: 'Editors only: students going this learning path who completed the board.' })
	doneCount?: number;

	@ApiPropertyOptional({ description: 'Editors only: students going this learning path.' })
	studentCount?: number;

	constructor(props: LearningPathStepResponse) {
		this.id = props.id;
		this.linkedBoardId = props.linkedBoardId;
		this.linkedCardId = props.linkedCardId;
		this.title = props.title;
		this.boardTitle = props.boardTitle;
		this.isVisible = props.isVisible;
		this.positionX = props.positionX;
		this.positionY = props.positionY;
		this.prerequisiteStepIds = props.prerequisiteStepIds;
		this.unlockMode = props.unlockMode;
		this.lockUntilPrerequisitesDone = props.lockUntilPrerequisitesDone;
		this.status = props.status;
		this.reopened = props.reopened;
		this.lock = props.lock;
		this.doneCount = props.doneCount;
		this.studentCount = props.studentCount;
	}
}

export class LearningPathCardStepPathResponse {
	@ApiProperty()
	pathId: string;

	@ApiProperty()
	pathTitle: string;

	@ApiPropertyOptional({ enum: LearningPathColor, enumName: 'LearningPathColor' })
	color?: LearningPathColor;

	@ApiProperty({ description: 'Number of the step in the learning path.' })
	position: number;

	@ApiProperty({ enum: STEP_STATUSES, enumName: 'LearningPathStepStatus' })
	status: LearningPathStepStatus;

	constructor(props: LearningPathCardStepPathResponse) {
		this.pathId = props.pathId;
		this.pathTitle = props.pathTitle;
		this.color = props.color;
		this.position = props.position;
		this.status = props.status;
	}
}

export class LearningPathCardStepResponse {
	@ApiProperty()
	cardId: string;

	@ApiProperty({ type: [LearningPathCardStepPathResponse] })
	paths: LearningPathCardStepPathResponse[];

	constructor(props: LearningPathCardStepResponse) {
		this.cardId = props.cardId;
		this.paths = props.paths;
	}
}

export class LearningPathCardStepListResponse {
	@ApiProperty({ type: [LearningPathCardStepResponse] })
	data: LearningPathCardStepResponse[];

	constructor(props: LearningPathCardStepListResponse) {
		this.data = props.data;
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

	@ApiPropertyOptional({ enum: LearningPathColor, enumName: 'LearningPathColor' })
	color?: LearningPathColor;

	@ApiPropertyOptional({ description: 'Students only: whether they go this learning path.' })
	isEnrolled?: boolean;

	@ApiPropertyOptional({ description: 'Students only: whether the room has several learning paths to choose from.' })
	canChoose?: boolean;

	@ApiPropertyOptional({ description: 'Editors only: students going this learning path.' })
	studentCount?: number;

	@ApiPropertyOptional({ description: 'Editors only: students who completed every published board of it.' })
	completedStudentCount?: number;

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
		this.color = props.color;
		this.isEnrolled = props.isEnrolled;
		this.canChoose = props.canChoose;
		this.studentCount = props.studentCount;
		this.completedStudentCount = props.completedStudentCount;
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

export class LearningPathOverviewPathResponse {
	@ApiProperty()
	id: string;

	@ApiProperty()
	title: string;

	@ApiPropertyOptional({ enum: LearningPathColor, enumName: 'LearningPathColor' })
	color?: LearningPathColor;

	@ApiProperty({ description: 'The published boards of the learning path.' })
	total: number;

	constructor(props: LearningPathOverviewPathResponse) {
		this.id = props.id;
		this.title = props.title;
		this.color = props.color;
		this.total = props.total;
	}
}

export class LearningPathOverviewProgressResponse {
	@ApiProperty()
	pathId: string;

	@ApiProperty()
	done: number;

	@ApiProperty()
	total: number;

	@ApiProperty({ description: 'Boards completed before that are not done any more because something new came up.' })
	rework: number;

	@ApiPropertyOptional({ description: 'The board the student can continue with.' })
	nextBoardTitle?: string;

	constructor(props: LearningPathOverviewProgressResponse) {
		this.pathId = props.pathId;
		this.done = props.done;
		this.total = props.total;
		this.rework = props.rework;
		this.nextBoardTitle = props.nextBoardTitle;
	}
}

export class LearningPathOverviewStudentResponse {
	@ApiProperty()
	userId: string;

	@ApiPropertyOptional()
	firstName?: string;

	@ApiPropertyOptional()
	lastName?: string;

	@ApiProperty({ type: [LearningPathOverviewProgressResponse], description: 'The learning paths the student goes.' })
	paths: LearningPathOverviewProgressResponse[];

	constructor(props: LearningPathOverviewStudentResponse) {
		this.userId = props.userId;
		this.firstName = props.firstName;
		this.lastName = props.lastName;
		this.paths = props.paths;
	}
}

export class LearningPathOverviewResponse {
	@ApiProperty({ type: [LearningPathOverviewPathResponse] })
	paths: LearningPathOverviewPathResponse[];

	@ApiProperty({ type: [LearningPathOverviewStudentResponse] })
	students: LearningPathOverviewStudentResponse[];

	constructor(props: LearningPathOverviewResponse) {
		this.paths = props.paths;
		this.students = props.students;
	}
}
