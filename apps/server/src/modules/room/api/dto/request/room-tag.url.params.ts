import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class RoomTagUrlParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the tag.', required: true, nullable: false })
	tagId!: string;
}
