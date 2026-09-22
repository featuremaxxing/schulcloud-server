import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class AssignmentListQueryParams {
	@IsOptional()
	@IsMongoId()
	@ApiPropertyOptional({ description: 'restrict the list to a single room; defaults to all rooms of the caller' })
	roomId?: string;
}
