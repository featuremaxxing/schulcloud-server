import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AppPasswordUrlParams {
	@ApiProperty({ description: 'The id of the app password.', required: true, nullable: false })
	@IsMongoId()
	appPasswordId!: string;
}
