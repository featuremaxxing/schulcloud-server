import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { ContentElementType } from '../../../domain';
import { TimestampsResponse } from '../timestamps.response';

export class MapMarkerResponse {
	constructor(props: MapMarkerResponse) {
		Object.assign(this, props);
	}

	@ApiProperty()
	latitude!: number;

	@ApiProperty()
	longitude!: number;
}

export class MapElementContent {
	constructor(props: MapElementContent) {
		Object.assign(this, props);
	}

	@ApiProperty({ description: 'Latitude of the center of the map excerpt.' })
	latitude!: number;

	@ApiProperty({ description: 'Longitude of the center of the map excerpt.' })
	longitude!: number;

	@ApiProperty({ description: 'OpenStreetMap zoom level of the map excerpt.' })
	zoom!: number;

	@ApiPropertyOptional({ type: MapMarkerResponse })
	marker?: MapMarkerResponse;
}

export class MapElementResponse {
	constructor(props: MapElementResponse) {
		Object.assign(this, props);
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id!: string;

	@ApiProperty({ enum: ContentElementType, enumName: 'ContentElementType' })
	type!: ContentElementType.MAP;

	@ApiProperty({ type: MapElementContent })
	content!: MapElementContent;

	@ApiProperty()
	timestamps!: TimestampsResponse;
}
