import { ApiProperty } from '@nestjs/swagger';
import { RoomCollectionResponse } from './room-collection.response';
import { RoomItemResponse } from './room-item.response';

export class RoomListResponse {
	constructor(data: RoomItemResponse[], collections: RoomCollectionResponse[] = []) {
		this.data = data;
		this.collections = collections;
	}

	@ApiProperty({ type: [RoomItemResponse] })
	data: RoomItemResponse[];

	@ApiProperty({ type: [RoomCollectionResponse], description: 'Personal collections the rooms are grouped in' })
	collections: RoomCollectionResponse[];
}
