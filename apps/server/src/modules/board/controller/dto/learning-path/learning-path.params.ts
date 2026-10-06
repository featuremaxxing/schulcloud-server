import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsOptional,
	Max,
	Min,
} from 'class-validator';
import { LEARNING_PATH_MAX_STEPS, LearningPathColor, type LearningPathUnlockMode } from '../../../domain';

const MAX_COORDINATE = 100000;

export class LearningPathBoardUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the board.', required: true, nullable: false })
	boardId!: string;
}

export class LearningPathRoomUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the room.', required: true, nullable: false })
	roomId!: string;
}

export class LearningPathCardUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the card.', required: true, nullable: false })
	cardId!: string;
}

export class LearningPathStepUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the learning path step.', required: true, nullable: false })
	stepId!: string;
}

export class CreateLearningPathStepBodyParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the learning path board.', required: true })
	boardId!: string;

	@IsMongoId()
	@ApiProperty({ description: 'The id of the board of the same room the step leads to.', required: true })
	linkedBoardId!: string;

	@IsOptional()
	@IsMongoId()
	@ApiPropertyOptional({
		description: 'The card the step leads to, on a board of the same room. Its board is taken as linkedBoardId.',
	})
	linkedCardId?: string;

	@IsInt()
	@Min(-MAX_COORDINATE)
	@Max(MAX_COORDINATE)
	@ApiProperty({ description: 'Horizontal position on the canvas.', required: true })
	positionX!: number;

	@IsInt()
	@Min(-MAX_COORDINATE)
	@Max(MAX_COORDINATE)
	@ApiProperty({ description: 'Vertical position on the canvas.', required: true })
	positionY!: number;
}

export class UpdateLearningPathStepBodyParams {
	@IsOptional()
	@IsInt()
	@Min(-MAX_COORDINATE)
	@Max(MAX_COORDINATE)
	@ApiPropertyOptional({ description: 'Horizontal position on the canvas.' })
	positionX?: number;

	@IsOptional()
	@IsInt()
	@Min(-MAX_COORDINATE)
	@Max(MAX_COORDINATE)
	@ApiPropertyOptional({ description: 'Vertical position on the canvas.' })
	positionY?: number;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(LEARNING_PATH_MAX_STEPS)
	@IsMongoId({ each: true })
	@ApiPropertyOptional({ description: 'The steps that lead to this one (incoming arrows).', type: [String] })
	prerequisiteStepIds?: string[];

	@IsOptional()
	@IsIn(['all', 'any'])
	@ApiPropertyOptional({
		description: 'Whether all prerequisites must be completed, or one of them is enough.',
		enum: ['all', 'any'],
	})
	unlockMode?: LearningPathUnlockMode;

	@IsOptional()
	@IsBoolean()
	@ApiPropertyOptional({ description: 'Students can open the board only after completing the prerequisites.' })
	lockUntilPrerequisitesDone?: boolean;
}

export class BoardCompletionBodyParams {
	@IsBoolean()
	@ApiProperty({ description: 'Whether the board is completed.', required: true })
	completed!: boolean;
}

export class UpdateLearningPathBodyParams {
	@IsEnum(LearningPathColor)
	@ApiProperty({
		description: 'The color of the learning path.',
		enum: LearningPathColor,
		enumName: 'LearningPathColor',
	})
	color!: LearningPathColor;
}

export class ResetLearningPathProgressBodyParams {
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(1000)
	@IsMongoId({ each: true })
	@ApiPropertyOptional({
		description: 'The students whose progress is reset. Default: all students of the room.',
		type: [String],
	})
	userIds?: string[];
}

export class LearningPathEnrollmentBodyParams {
	@IsOptional()
	@IsMongoId()
	@ApiPropertyOptional({
		description: 'Editors only: the member of the room to enroll or remove. Default: the caller.',
	})
	userId?: string;
}
