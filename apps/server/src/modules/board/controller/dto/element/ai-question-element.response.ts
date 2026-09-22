import { ApiProperty } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { ContentElementType } from '../../../domain';
import { TimestampsResponse } from '../timestamps.response';

// Deliberately holds only what every board participant may see: the question itself and
// whether re-answering is allowed. The teacher's aiInstructions and the expectedAnswer
// (the grading reference!) are withheld here - this response is broadcast to every
// participant over the collaboration socket - and served to editors only through the
// AI module's config endpoint (see AiQuestionUc.getConfig). The same split as with
// assignment elements, whose per-user data lives behind the /assignments endpoints.
export class AiQuestionElementContent {
	constructor(props: AiQuestionElementContent) {
		this.question = props.question;
		this.allowMultipleAttempts = props.allowMultipleAttempts;
	}

	@ApiProperty()
	question: string;

	@ApiProperty({ description: 'whether students may replace their answer; false = single attempt' })
	allowMultipleAttempts: boolean;
}

export class AiQuestionElementResponse {
	constructor(props: AiQuestionElementResponse) {
		this.id = props.id;
		this.type = props.type;
		this.content = props.content;
		this.timestamps = props.timestamps;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id: string;

	@ApiProperty({ enum: ContentElementType, enumName: 'ContentElementType' })
	type: ContentElementType.AI_QUESTION;

	@ApiProperty()
	content: AiQuestionElementContent;

	@ApiProperty()
	timestamps: TimestampsResponse;
}
