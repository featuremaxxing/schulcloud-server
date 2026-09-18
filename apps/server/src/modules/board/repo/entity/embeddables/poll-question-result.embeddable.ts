import { Embedded, Embeddable, Property } from '@mikro-orm/core';
import type { PollQuestionResult as PollQuestionResultProps } from '../../../domain';
import { PollResultCountEmbeddable } from './poll-result-count.embeddable';

@Embeddable()
export class PollQuestionResultEmbeddable {
	@Property()
	questionId: string;

	@Embedded(() => PollResultCountEmbeddable, { array: true })
	counts: PollResultCountEmbeddable[];

	@Property({ nullable: true })
	textAnswers?: string[];

	constructor(props: PollQuestionResultProps) {
		this.questionId = props.questionId;
		this.counts = props.counts.map((count) => new PollResultCountEmbeddable(count));
		this.textAnswers = props.textAnswers;
	}
}
