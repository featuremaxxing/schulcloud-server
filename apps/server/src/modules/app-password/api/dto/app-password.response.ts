import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AppPasswordResponse {
	constructor(props: AppPasswordResponse) {
		this.id = props.id;
		this.name = props.name;
		this.createdAt = props.createdAt;
		this.lastUsedAt = props.lastUsedAt;
	}

	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty({ type: Date })
	createdAt: Date;

	@ApiPropertyOptional({ type: Date })
	lastUsedAt?: Date;
}

export class AppPasswordListResponse {
	constructor(data: AppPasswordResponse[]) {
		this.data = data;
	}

	@ApiProperty({ type: [AppPasswordResponse] })
	data: AppPasswordResponse[];
}

export class CreatedAppPasswordResponse extends AppPasswordResponse {
	constructor(props: CreatedAppPasswordResponse) {
		super(props);
		this.token = props.token;
		this.username = props.username;
	}

	@ApiProperty({ description: 'The secret. It is only returned once and cannot be recovered.' })
	token: string;

	@ApiProperty({ description: 'Username to enter together with the token in the client.' })
	username: string;
}
