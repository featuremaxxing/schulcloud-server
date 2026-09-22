import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PeerReviewSettingsResponse {
	constructor(props: PeerReviewSettingsResponse) {
		this.enabled = props.enabled;
		this.mode = props.mode;
		this.count = props.count;
	}

	@ApiProperty()
	enabled: boolean;

	@ApiProperty({ enum: ['manual', 'auto'] })
	mode: 'manual' | 'auto';

	@ApiPropertyOptional({ type: Number })
	count: number;
}
