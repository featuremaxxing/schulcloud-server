import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { IsBoolean, IsString, MaxLength } from 'class-validator';

export class CreateAiQuestionAnswerBodyParams {
	@IsString()
	@MaxLength(10000)
	@ApiProperty({ description: 'the student\u2019s answer text' })
	answer!: string;
}

export class SetAiQuestionAnswerFlagBodyParams {
	@IsBoolean()
	@ApiProperty()
	flagged!: boolean;
}

export class AiQuestionConfigResponse {
	constructor(props: AiQuestionConfigResponse) {
		this.question = props.question;
		this.aiInstructions = props.aiInstructions;
		this.expectedAnswer = props.expectedAnswer;
		this.allowMultipleAttempts = props.allowMultipleAttempts;
	}

	@ApiProperty()
	question: string;

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		description: 'guidance for the AI - editors only, never broadcast',
	})
	aiInstructions: string | null;

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		description: 'grading reference - editors only, never broadcast',
	})
	expectedAnswer: string | null;

	@ApiProperty()
	allowMultipleAttempts: boolean;
}

export class AiQuestionAnswerResponse {
	constructor(props: AiQuestionAnswerResponse) {
		this.id = props.id;
		this.userId = props.userId;
		this.answer = props.answer;
		this.aiResponse = props.aiResponse;
		this.answeredAt = props.answeredAt;
		this.attemptCount = props.attemptCount;
		this.points = props.points;
		this.maxPoints = props.maxPoints;
		this.aiFlagged = props.aiFlagged;
		this.aiFlagReason = props.aiFlagReason;
		this.studentFlagged = props.studentFlagged;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	id: string;

	@ApiProperty({ pattern: bsonStringPattern })
	userId: string;

	@ApiProperty()
	answer: string;

	@ApiProperty()
	aiResponse: string;

	@ApiProperty()
	answeredAt: string;

	@ApiProperty()
	attemptCount: number;

	@ApiPropertyOptional({ type: Number, nullable: true })
	points: number | null;

	@ApiPropertyOptional({ type: Number, nullable: true })
	maxPoints: number | null;

	@ApiProperty()
	aiFlagged: boolean;

	@ApiPropertyOptional({ type: String, nullable: true })
	aiFlagReason: string | null;

	@ApiProperty()
	studentFlagged: boolean;
}

// Own-answer view: `answer` is null until the student has answered for the first time.
export class AiQuestionOwnAnswerResponse {
	constructor(props: AiQuestionOwnAnswerResponse) {
		this.answer = props.answer;
	}

	@ApiPropertyOptional({ type: AiQuestionAnswerResponse, nullable: true })
	answer: AiQuestionAnswerResponse | null;
}

export class AiQuestionAnswerTeacherResponse extends AiQuestionAnswerResponse {
	constructor(props: AiQuestionAnswerTeacherResponse) {
		super(props);
		this.firstName = props.firstName;
		this.lastName = props.lastName;
	}

	@ApiPropertyOptional({ nullable: true })
	firstName?: string | null;

	@ApiPropertyOptional({ nullable: true })
	lastName?: string | null;
}

export class AiQuestionAnswersListResponse {
	constructor(props: AiQuestionAnswersListResponse) {
		this.answers = props.answers;
	}

	@ApiProperty({ type: [AiQuestionAnswerTeacherResponse] })
	answers: AiQuestionAnswerTeacherResponse[];
}
