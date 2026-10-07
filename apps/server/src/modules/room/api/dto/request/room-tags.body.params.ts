import { ApiProperty } from '@nestjs/swagger';
import { SanitizeHtml, sanitizeRichText } from '@shared/controller/transformer';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class RoomTagsBodyParams {
	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(50, { each: true })
	@Transform(({ value }: { value: unknown }): unknown =>
		Array.isArray(value)
			? value.map((name: unknown): unknown => (typeof name === 'string' ? sanitizeRichText(name) : name))
			: value
	)
	@ApiProperty({ type: [String], description: 'Names of the personal tags of the room; unknown names create new tags' })
	names!: string[];
}

export class RenameRoomTagBodyParams {
	@IsString()
	@MinLength(1)
	@MaxLength(50)
	@SanitizeHtml()
	@ApiProperty({ description: 'The new name of the tag', required: true, nullable: false })
	name!: string;
}
