import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { BoardRoles, ContentElementType, PollAudience } from '../../../domain';
import { TimestampsResponse } from '../timestamps.response';

export class CheckboxElementContent {
	constructor(props: CheckboxElementContent) {
		Object.assign(this, props);
	}
	@ApiProperty()
	text!: string;
	@ApiProperty()
	requireTeacherConfirmation!: boolean;
	@ApiProperty({ enum: PollAudience, enumName: 'PollAudience' })
	audience!: PollAudience;
	@ApiPropertyOptional({ enum: BoardRoles, enumName: 'BoardRoles', isArray: true })
	audienceRoles?: BoardRoles[];
}

// Per-student state must never be part of this broadcast response.
export class CheckboxElementResponse {
	constructor(props: CheckboxElementResponse) {
		Object.assign(this, props);
	}
	@ApiProperty({ pattern: bsonStringPattern })
	id!: string;
	@ApiProperty({ enum: ContentElementType, enumName: 'ContentElementType' })
	type!: ContentElementType.CHECKBOX;
	@ApiProperty({ type: CheckboxElementContent })
	content!: CheckboxElementContent;
	@ApiProperty()
	timestamps!: TimestampsResponse;
}
