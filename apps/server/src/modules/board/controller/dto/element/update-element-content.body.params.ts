import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { InputFormat } from '@shared/domain/types';
import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsDateString,
	IsEnum,
	IsInt,
	IsMongoId,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { BoardRoles } from '../../../domain/board-node-authorizable.do';
import { ContentElementType } from '../../../domain/types';
import { PollAnswerMode, PollAudience, PollChartType, PollStatus } from '../../../domain/types/poll.types';

abstract class ElementContentBody {
	@IsEnum(ContentElementType)
	@ApiProperty({
		enum: ContentElementType,
		description: 'the type of the updated element',
		enumName: 'ContentElementType',
	})
	type!: ContentElementType;
}

export class FileContentBody {
	@IsString()
	@ApiProperty({})
	caption!: string;

	@IsString()
	@ApiProperty({})
	alternativeText!: string;
}

export class FileElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.FILE })
	type!: ContentElementType.FILE;

	@ValidateNested()
	@ApiProperty()
	content!: FileContentBody;
}

export class LinkContentBody {
	@IsString()
	@ApiProperty({})
	url!: string;

	@IsString()
	@IsOptional()
	@ApiProperty({})
	title?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({})
	description?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({})
	imageUrl?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({})
	originalImageUrl?: string;
}

export class LinkElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.LINK })
	type!: ContentElementType.LINK;

	@ValidateNested()
	@ApiProperty({})
	content!: LinkContentBody;
}

export class DrawingContentBody {
	@IsString()
	@ApiProperty()
	description!: string;
}

export class DrawingElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.DRAWING })
	type!: ContentElementType.DRAWING;

	@ValidateNested()
	@ApiProperty()
	content!: DrawingContentBody;
}

export class RichTextContentBody {
	@IsString()
	@ApiProperty()
	text!: string;

	@IsEnum(InputFormat)
	@ApiProperty()
	inputFormat!: InputFormat;
}

export class RichTextElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.RICH_TEXT })
	type!: ContentElementType.RICH_TEXT;

	@ValidateNested()
	@ApiProperty()
	content!: RichTextContentBody;
}

export class ExternalToolContentBody {
	@IsMongoId()
	@IsOptional()
	@ApiPropertyOptional()
	contextExternalToolId?: string;
}

export class ExternalToolElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.EXTERNAL_TOOL })
	type!: ContentElementType.EXTERNAL_TOOL;

	@ValidateNested()
	@ApiProperty()
	content!: ExternalToolContentBody;
}

export class VideoConferenceContentBody {
	@IsString()
	@ApiProperty()
	title!: string;
}

export class VideoConferenceElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.VIDEO_CONFERENCE })
	type!: ContentElementType.VIDEO_CONFERENCE;

	@ValidateNested()
	@ApiProperty()
	content!: VideoConferenceContentBody;
}

export class FileFolderContentBody {
	@IsString()
	@ApiProperty()
	title!: string;
}

export class FileFolderElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.FILE_FOLDER })
	type!: ContentElementType.FILE_FOLDER;

	@ValidateNested()
	@ApiProperty()
	content!: FileFolderContentBody;
}

export class H5pContentBody {
	@IsMongoId()
	@IsOptional()
	@ApiPropertyOptional()
	contentId?: string;
}

export class H5pElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.H5P })
	type!: ContentElementType.H5P;

	@ValidateNested()
	@ApiProperty()
	content!: H5pContentBody;
}

// Nest runs with no custom body-parser limit, i.e. the Express default of ~100kB - an
// undocumented implicit limit on the whole request body. Question/option text lengths and
// array sizes are capped defensively so a poll cannot alone exhaust that budget.
export class PollOptionBody {
	// Not necessarily a Mongo id: the client may send its own freshly generated id for a
	// brand-new option (the server assigns one if missing, see updatePollElement()).
	@IsString()
	@IsOptional()
	@MaxLength(64)
	@ApiPropertyOptional()
	id?: string;

	@IsString()
	@MaxLength(200)
	@ApiProperty()
	text!: string;
}

export class PollQuestionBody {
	@IsString()
	@IsOptional()
	@MaxLength(64)
	@ApiPropertyOptional()
	id?: string;

	@IsString()
	@MaxLength(500)
	@ApiProperty()
	text!: string;

	@IsEnum(PollAnswerMode)
	@ApiProperty({ enum: PollAnswerMode, enumName: 'PollAnswerMode' })
	answerMode!: PollAnswerMode;

	@IsEnum(PollChartType)
	@ApiProperty({ enum: PollChartType, enumName: 'PollChartType' })
	chartType!: PollChartType;

	@IsArray()
	@ArrayMaxSize(10)
	@ValidateNested({ each: true })
	@Type(() => PollOptionBody)
	@ApiProperty({ type: () => [PollOptionBody] })
	options!: PollOptionBody[];
}

export class PollContentBody {
	@IsString()
	@IsOptional()
	@MaxLength(500)
	@ApiPropertyOptional()
	title?: string;

	@IsArray()
	@ArrayMaxSize(20)
	@ValidateNested({ each: true })
	@Type(() => PollQuestionBody)
	@ApiProperty({ type: () => [PollQuestionBody] })
	questions!: PollQuestionBody[];

	@IsBoolean()
	@ApiProperty()
	isAnonymous!: boolean;

	@IsBoolean()
	@ApiProperty()
	showResultsLive!: boolean;

	@IsEnum(PollStatus)
	@ApiProperty({ enum: PollStatus, enumName: 'PollStatus' })
	pollStatus!: PollStatus;

	@IsDateString()
	@IsOptional()
	@ApiPropertyOptional()
	opensAt?: string;

	@IsDateString()
	@IsOptional()
	@ApiPropertyOptional()
	closesAt?: string;

	@IsEnum(PollAudience)
	@IsOptional()
	@ApiPropertyOptional({ enum: PollAudience, enumName: 'PollAudience' })
	audience?: PollAudience;

	@IsArray()
	@IsEnum(BoardRoles, { each: true })
	@IsOptional()
	@ArrayMaxSize(3)
	@ApiPropertyOptional({ enum: BoardRoles, enumName: 'BoardRoles', isArray: true })
	audienceRoles?: BoardRoles[];

	@IsBoolean()
	@IsOptional()
	@ApiPropertyOptional()
	allowVoteChange?: boolean;
}

export class PollElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.POLL })
	type!: ContentElementType.POLL;

	@ValidateNested()
	@Type(() => PollContentBody)
	@ApiProperty()
	content!: PollContentBody;
}

export class AssignmentRubricCriterionBody {
	@IsString()
	@ApiProperty({ description: 'client-generated id, stable across edits so submissions can reference it' })
	id!: string;

	@IsString()
	@ApiProperty()
	name!: string;

	@IsInt()
	@Min(1)
	@Max(1000)
	@ApiProperty()
	maxPoints!: number;
}

export class AssignmentContentBody {
	@IsString()
	@ApiProperty()
	title!: string;

	@IsString()
	@ApiProperty()
	text!: string;

	@IsEnum(InputFormat)
	@ApiProperty()
	inputFormat!: InputFormat;

	@IsDateString()
	@IsOptional()
	@ApiPropertyOptional()
	startDate?: string;

	@IsDateString()
	@IsOptional()
	@ApiPropertyOptional()
	dueDate?: string;

	@IsInt()
	@Min(0)
	@Max(60 * 24 * 30)
	@IsOptional()
	@ApiPropertyOptional({ description: 'grace period after dueDate in minutes, during which a submission is late' })
	graceMinutes?: number;

	@IsInt()
	@Min(1)
	@Max(1000)
	@IsOptional()
	@ApiPropertyOptional()
	maxPoints?: number;

	@IsArray()
	@ArrayMaxSize(50)
	@ValidateNested({ each: true })
	@Type(() => AssignmentRubricCriterionBody)
	@IsOptional()
	@ApiPropertyOptional({ type: [AssignmentRubricCriterionBody] })
	criteria?: AssignmentRubricCriterionBody[];
}

export class AssignmentElementContentBody extends ElementContentBody {
	@ApiProperty({ type: () => ContentElementType.ASSIGNMENT })
	type!: ContentElementType.ASSIGNMENT;

	@ValidateNested()
	@ApiProperty()
	content!: AssignmentContentBody;
}

export type AnyElementContentBody =
	| AssignmentContentBody
	| FileContentBody
	| DrawingContentBody
	| LinkContentBody
	| RichTextContentBody
	| ExternalToolContentBody
	| VideoConferenceContentBody
	| FileFolderContentBody
	| H5pContentBody
	| PollContentBody;

export class UpdateElementContentBodyParams {
	@ValidateNested()
	@Type(() => ElementContentBody, {
		discriminator: {
			property: 'type',
			subTypes: [
				{ value: FileElementContentBody, name: ContentElementType.FILE },
				{ value: LinkElementContentBody, name: ContentElementType.LINK },
				{ value: RichTextElementContentBody, name: ContentElementType.RICH_TEXT },
				{ value: ExternalToolElementContentBody, name: ContentElementType.EXTERNAL_TOOL },
				{ value: DrawingElementContentBody, name: ContentElementType.DRAWING },
				{ value: VideoConferenceElementContentBody, name: ContentElementType.VIDEO_CONFERENCE },
				{ value: FileFolderElementContentBody, name: ContentElementType.FILE_FOLDER },
				{ value: H5pElementContentBody, name: ContentElementType.H5P },
				{ value: PollElementContentBody, name: ContentElementType.POLL },
				{ value: AssignmentElementContentBody, name: ContentElementType.ASSIGNMENT },
			],
		},
		keepDiscriminatorProperty: true,
	})
	@ApiProperty({
		oneOf: [
			{ $ref: getSchemaPath(FileElementContentBody) },
			{ $ref: getSchemaPath(LinkElementContentBody) },
			{ $ref: getSchemaPath(RichTextElementContentBody) },
			{ $ref: getSchemaPath(ExternalToolElementContentBody) },
			{ $ref: getSchemaPath(DrawingElementContentBody) },
			{ $ref: getSchemaPath(VideoConferenceElementContentBody) },
			{ $ref: getSchemaPath(FileFolderElementContentBody) },
			{ $ref: getSchemaPath(H5pElementContentBody) },
			{ $ref: getSchemaPath(PollElementContentBody) },
			{ $ref: getSchemaPath(AssignmentElementContentBody) },
		],
	})
	data!:
		| FileElementContentBody
		| LinkElementContentBody
		| RichTextElementContentBody
		| ExternalToolElementContentBody
		| DrawingElementContentBody
		| VideoConferenceElementContentBody
		| FileFolderElementContentBody
		| H5pElementContentBody
		| PollElementContentBody
		| AssignmentElementContentBody;
}
