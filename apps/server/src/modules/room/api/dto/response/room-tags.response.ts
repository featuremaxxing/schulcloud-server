import { ApiProperty } from '@nestjs/swagger';
import { RoomTagResponse } from './room-tag.response';

export class RoomTagsResponse {
	@ApiProperty({ type: [String], description: 'The ids of the tags of the room' })
	tagIds: string[];

	@ApiProperty({ type: [RoomTagResponse], description: 'All personal tags of the user' })
	tags: RoomTagResponse[];

	constructor(tagIds: string[], tags: RoomTagResponse[]) {
		this.tagIds = tagIds;
		this.tags = tags;
	}
}
