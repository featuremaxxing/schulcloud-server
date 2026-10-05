import { ApiProperty } from '@nestjs/swagger';

export class RoomCollectionResponse {
	@ApiProperty()
	id: string;

	@ApiProperty()
	title: string;

	constructor(collection: RoomCollectionResponse) {
		this.id = collection.id;
		this.title = collection.title;
	}
}
