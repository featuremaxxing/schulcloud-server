import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { ContentElementType, PollAnswerMode, PollChartType, PollStatus } from '../../../domain';
import { TimestampsResponse } from '../timestamps.response';

export class PollOptionResponse {
	constructor(props: PollOptionResponse) {
		this.id = props.id;
		this.text = props.text;
	}

	@ApiProperty()
	id: string;

	@ApiProperty()
	text: string;
}

export class PollQuestionResponse {
	constructor(props: PollQuestionResponse) {
		this.id = props.id;
		this.text = props.text;
		this.answerMode = props.answerMode;
		this.chartType = props.chartType;
		this.options = props.options;
	}

	@ApiProperty()
	id: string;

	@ApiProperty()
	text: string;

	@ApiProperty({ enum: PollAnswerMode, enumName: 'PollAnswerMode' })
	answerMode: PollAnswerMode;

	@ApiProperty({ enum: PollChartType, enumName: 'PollChartType' })
	chartType: PollChartType;

	@ApiProperty({ type: () => [PollOptionResponse] })
	options: PollOptionResponse[];
}

export class PollResultCountResponse {
	constructor(props: PollResultCountResponse) {
		this.optionId = props.optionId;
		this.count = props.count;
	}

	@ApiProperty()
	optionId: string;

	@ApiProperty()
	count: number;
}

export class PollQuestionResultResponse {
	constructor(props: PollQuestionResultResponse) {
		this.questionId = props.questionId;
		this.counts = props.counts;
		this.textAnswers = props.textAnswers;
	}

	@ApiProperty()
	questionId: string;

	@ApiProperty({ type: () => [PollResultCountResponse] })
	counts: PollResultCountResponse[];

	@ApiPropertyOptional({ type: [String] })
	textAnswers?: string[];
}

export class PollResultSnapshotResponse {
	constructor(props: PollResultSnapshotResponse) {
		this.frozenAt = props.frozenAt;
		this.participantCount = props.participantCount;
		this.perQuestion = props.perQuestion;
	}

	@ApiProperty()
	frozenAt: string;

	@ApiProperty()
	participantCount: number;

	@ApiProperty({ type: () => [PollQuestionResultResponse] })
	perQuestion: PollQuestionResultResponse[];
}

// Deliberately holds only the teacher-authored configuration of the poll (questions,
// switches, status, the frozen resultSnapshot once closed) - never anything about a
// specific participant's vote. This response is broadcast to every board participant
// over the collaboration socket; per-user data (myVote) is served only through the
// dedicated GET /polls/:elementId/results endpoint.
export class PollElementContent {
	constructor(props: PollElementContent) {
		this.title = props.title;
		this.questions = props.questions;
		this.isAnonymous = props.isAnonymous;
		this.showResultsLive = props.showResultsLive;
		this.pollStatus = props.pollStatus;
		this.closesAt = props.closesAt;
		this.resultSnapshot = props.resultSnapshot;
	}

	@ApiPropertyOptional()
	title?: string;

	@ApiProperty({ type: () => [PollQuestionResponse] })
	questions: PollQuestionResponse[];

	@ApiProperty()
	isAnonymous: boolean;

	@ApiProperty()
	showResultsLive: boolean;

	@ApiProperty({ enum: PollStatus, enumName: 'PollStatus' })
	pollStatus: PollStatus;

	@ApiPropertyOptional({ type: String, nullable: true })
	closesAt?: string | null;

	@ApiPropertyOptional({ type: PollResultSnapshotResponse, nullable: true })
	resultSnapshot?: PollResultSnapshotResponse | null;
}

export class PollElementResponse {
	constructor(props: PollElementResponse) {
		this.id = props.id;
		this.type = props.type;
		this.content = props.content;
		this.timestamps = props.timestamps;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id: string;

	@ApiProperty({ enum: ContentElementType, enumName: 'ContentElementType' })
	type: ContentElementType.POLL;

	@ApiProperty()
	content: PollElementContent;

	@ApiProperty()
	timestamps: TimestampsResponse;
}
