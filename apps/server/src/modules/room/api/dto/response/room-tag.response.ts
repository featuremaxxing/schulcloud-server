import { ApiProperty } from '@nestjs/swagger';

export class RoomTagResponse {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	constructor(tag: RoomTagResponse) {
		this.id = tag.id;
		this.name = tag.name;
	}
}
