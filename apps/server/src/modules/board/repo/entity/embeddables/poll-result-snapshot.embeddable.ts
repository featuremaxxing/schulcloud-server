import { Embedded, Embeddable, Property } from '@mikro-orm/core';
import type { PollResultSnapshot as PollResultSnapshotProps } from '../../../domain';
import { PollQuestionResultEmbeddable } from './poll-question-result.embeddable';

@Embeddable()
export class PollResultSnapshotEmbeddable {
	@Property({ type: 'Date' })
	frozenAt: Date;

	@Property({ type: 'integer' })
	participantCount: number;

	@Embedded(() => PollQuestionResultEmbeddable, { array: true })
	perQuestion: PollQuestionResultEmbeddable[];

	constructor(props: PollResultSnapshotProps) {
		this.frozenAt = props.frozenAt;
		this.participantCount = props.participantCount;
		this.perQuestion = props.perQuestion.map((question) => new PollQuestionResultEmbeddable(question));
	}
}
