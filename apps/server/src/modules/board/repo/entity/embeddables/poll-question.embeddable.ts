import { Embedded, Embeddable, Enum, Property } from '@mikro-orm/core';
import { PollAnswerMode, PollChartType, type PollQuestion as PollQuestionProps } from '../../../domain';
import { PollOptionEmbeddable } from './poll-option.embeddable';

@Embeddable()
export class PollQuestionEmbeddable {
	@Property()
	id: string;

	@Property()
	text: string;

	@Enum(() => PollAnswerMode)
	answerMode: PollAnswerMode;

	@Enum(() => PollChartType)
	chartType: PollChartType;

	@Embedded(() => PollOptionEmbeddable, { array: true })
	options: PollOptionEmbeddable[];

	constructor(props: PollQuestionProps) {
		this.id = props.id;
		this.text = props.text;
		this.answerMode = props.answerMode;
		this.chartType = props.chartType;
		this.options = props.options.map((option) => new PollOptionEmbeddable(option));
	}
}
