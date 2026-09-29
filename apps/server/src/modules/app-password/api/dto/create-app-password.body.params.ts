import { ApiProperty } from '@nestjs/swagger';
import { SanitizeHtml } from '@shared/controller/transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAppPasswordBodyParams {
	@ApiProperty({ description: 'Label to recognize the app password later, e.g. "Laptop Finder"' })
	@IsString()
	@SanitizeHtml()
	@MinLength(1)
	@MaxLength(100)
	name!: string;
}
