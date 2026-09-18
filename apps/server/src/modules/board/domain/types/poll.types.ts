export enum PollAnswerMode {
	SINGLE = 'single',
	MULTIPLE = 'multiple',
	TEXT = 'text',
}

export enum PollChartType {
	BAR = 'bar',
	COLUMN = 'column',
	DONUT = 'donut',
	STACKED = 'stacked',
}

export enum PollStatus {
	DRAFT = 'draft',
	OPEN = 'open',
	CLOSED = 'closed',
}

export interface PollOption {
	id: string;
	text: string;
}

export interface PollQuestion {
	id: string;
	text: string;
	answerMode: PollAnswerMode;
	chartType: PollChartType;
	options: PollOption[];
}

// One entry per question inside a PollVote. selectedOptionIds is used for single/multiple
// choice questions, textAnswer for free-text questions - never both meaningfully at once.
export interface PollAnswer {
	questionId: string;
	selectedOptionIds: string[];
	textAnswer?: string;
}

export interface PollResultCount {
	optionId: string;
	count: number;
}

// Anonymous, aggregated numbers only - never raw voter identities. Voter names for
// non-anonymous polls are derived live from PollVote children by the results endpoint,
// not stored here.
export interface PollQuestionResult {
	questionId: string;
	counts: PollResultCount[];
	textAnswers?: string[];
}

export interface PollResultSnapshot {
	frozenAt: Date;
	participantCount: number;
	perQuestion: PollQuestionResult[];
}
