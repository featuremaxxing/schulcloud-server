import { ApiProperty } from '@nestjs/swagger';
import { RoomItemResponse } from './room-item.response';
import { RoomTagResponse } from './room-tag.response';

export class RoomListResponse {
	constructor(data: RoomItemResponse[], tags: RoomTagResponse[] = []) {
		this.data = data;
		this.tags = tags;
	}

	@ApiProperty({ type: [RoomItemResponse] })
	data: RoomItemResponse[];

	@ApiProperty({ type: [RoomTagResponse], description: 'Personal tags of the user' })
	tags: RoomTagResponse[];
}
