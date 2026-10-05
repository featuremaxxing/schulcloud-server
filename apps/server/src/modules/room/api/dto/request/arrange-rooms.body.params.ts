import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SanitizeHtml } from '@shared/controller/transformer';
import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsMongoId,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	ValidateNested,
} from 'class-validator';

export class RoomArrangementItemParams {
	@IsMongoId()
	@ApiProperty({ description: 'The id of the room', required: true, nullable: false })
	id!: string;

	@IsOptional()
	@IsUUID()
	@ApiPropertyOptional({ description: 'The id of the collection the room is placed in' })
	collectionId?: string;
}

export class RoomCollectionParams {
	@IsUUID()
	@ApiProperty({ description: 'Client-generated id of the collection', required: true, nullable: false })
	id!: string;

	@IsString()
	@MaxLength(100)
	@SanitizeHtml()
	@ApiProperty({ description: 'The title of the collection', required: true, nullable: false })
	title!: string;
}

export class ArrangeRoomsBodyParams {
	@IsArray()
	@ArrayMaxSize(5000)
	@ValidateNested({ each: true })
	@Type(() => RoomArrangementItemParams)
	@ApiProperty({ type: [RoomArrangementItemParams], description: 'All rooms of the user in display order' })
	items!: RoomArrangementItemParams[];

	@IsArray()
	@ArrayMaxSize(1000)
	@ValidateNested({ each: true })
	@Type(() => RoomCollectionParams)
	@ApiProperty({ type: [RoomCollectionParams], description: 'The collections the rooms are grouped in' })
	collections!: RoomCollectionParams[];
}
