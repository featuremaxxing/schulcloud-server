import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { DecodeHtmlEntities } from '@shared/controller/transformer';
import { ContentElementType, type FileAreaLinkTargetType } from '../../../domain';
import { TimestampsResponse } from '../timestamps.response';

export class FileAreaLinkElementContent {
	constructor(props: FileAreaLinkElementContent) {
		Object.assign(this, props);
	}

	@ApiPropertyOptional({ pattern: bsonStringPattern, description: 'The file area the target belongs to.' })
	fileAreaId?: string;

	@ApiPropertyOptional({ enum: ['file', 'folder'], enumName: 'FileAreaLinkTargetType' })
	targetType?: FileAreaLinkTargetType;

	@ApiPropertyOptional({ description: 'The id of the file record or of the folder.' })
	targetId?: string;

	@ApiProperty({ description: 'The name of the target when it was linked.' })
	@DecodeHtmlEntities()
	title!: string;
}

export class FileAreaLinkElementResponse {
	constructor(props: FileAreaLinkElementResponse) {
		Object.assign(this, props);
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id!: string;

	@ApiProperty({ enum: ContentElementType, enumName: 'ContentElementType' })
	type!: ContentElementType.FILE_AREA_LINK;

	@ApiProperty({ type: FileAreaLinkElementContent })
	content!: FileAreaLinkElementContent;

	@ApiProperty()
	timestamps!: TimestampsResponse;
}
