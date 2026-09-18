import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { bsonStringPattern } from '@shared/controller/bson-string-pattern';
import { PollQuestionResultResponse } from '../element/poll-element.response';

export class PollAnswerResponse {
	constructor(props: PollAnswerResponse) {
		this.questionId = props.questionId;
		this.selectedOptionIds = props.selectedOptionIds;
		this.textAnswer = props.textAnswer;
	}

	@ApiProperty()
	questionId: string;

	@ApiProperty({ type: [String] })
	selectedOptionIds: string[];

	@ApiPropertyOptional()
	textAnswer?: string;
}

// Voter identities are never anonymized in the domain layer - this endpoint only includes
// this list at all when the poll is non-anonymous AND the requesting user is allowed to
// manage the poll (see PollUc.getResults).
export class PollVoterResponse {
	constructor(props: PollVoterResponse) {
		this.userId = props.userId;
		this.answers = props.answers;
	}

	@ApiProperty({ pattern: bsonStringPattern })
	userId: string;

	@ApiProperty({ type: () => [PollAnswerResponse] })
	answers: PollAnswerResponse[];
}

export class PollResultsResponse {
	constructor(props: PollResultsResponse) {
		this.totalVotes = props.totalVotes;
		this.participantCount = props.participantCount;
		this.myVote = props.myVote;
		this.results = props.results;
		this.voters = props.voters;
	}

	@ApiProperty()
	totalVotes: number;

	@ApiProperty()
	participantCount: number;

	@ApiPropertyOptional({ type: () => [PollAnswerResponse] })
	myVote?: PollAnswerResponse[];

	@ApiPropertyOptional({ type: () => [PollQuestionResultResponse] })
	results?: PollQuestionResultResponse[];

	@ApiPropertyOptional({ type: () => [PollVoterResponse] })
	voters?: PollVoterResponse[];
}
