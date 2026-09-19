import { Embeddable, Property } from '@mikro-orm/core';
import type { PollResultCount as PollResultCountProps } from '../../../domain';

@Embeddable()
export class PollResultCountEmbeddable {
	@Property()
	optionId: string;

	@Property({ type: 'integer' })
	count: number;

	constructor(props: PollResultCountProps) {
		this.optionId = props.optionId;
		this.count = props.count;
	}
}
