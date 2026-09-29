import { Embeddable, Property } from '@mikro-orm/core';
import type { PollOption as PollOptionProps } from '../../../domain';

@Embeddable()
export class PollOptionEmbeddable {
	@Property()
	id: string;

	@Property()
	text: string;

	constructor(props: PollOptionProps) {
		this.id = props.id;
		this.text = props.text;
	}
}
