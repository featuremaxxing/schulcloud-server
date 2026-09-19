import { BoardNode } from './board-node.do';
import { isPollVote } from './poll-vote.do';
import type { AnyBoardNode, PollElementProps, PollQuestion, PollResultSnapshot } from './types';
import { PollStatus } from './types';

export class PollElement extends BoardNode<PollElementProps> {
	get title(): string | undefined {
		return this.props.title;
	}

	set title(value: string | undefined) {
		this.props.title = value;
	}

	get questions(): PollQuestion[] {
		return this.props.questions;
	}

	set questions(value: PollQuestion[]) {
		this.props.questions = value;
	}

	get isAnonymous(): boolean {
		return this.props.isAnonymous;
	}

	set isAnonymous(value: boolean) {
		this.props.isAnonymous = value;
	}

	get showResultsLive(): boolean {
		return this.props.showResultsLive;
	}

	set showResultsLive(value: boolean) {
		this.props.showResultsLive = value;
	}

	get pollStatus(): PollStatus {
		return this.props.pollStatus;
	}

	set pollStatus(value: PollStatus) {
		this.props.pollStatus = value;
	}

	get closesAt(): Date | undefined {
		return this.props.closesAt;
	}

	set closesAt(value: Date | undefined) {
		this.props.closesAt = value;
	}

	get resultSnapshot(): PollResultSnapshot | undefined {
		return this.props.resultSnapshot;
	}

	set resultSnapshot(value: PollResultSnapshot | undefined) {
		this.props.resultSnapshot = value;
	}

	// A poll only ever accepts votes while explicitly opened and, if a deadline is set,
	// before it passes. Closing (or never opening) always wins over a future closesAt.
	public isOpen(now: Date): boolean {
		if (this.pollStatus !== PollStatus.OPEN) {
			return false;
		}

		if (this.closesAt && now.getTime() >= this.closesAt.getTime()) {
			return false;
		}

		return true;
	}

	public canHaveChild(childNode: AnyBoardNode): boolean {
		return isPollVote(childNode);
	}
}

export const isPollElement = (reference: unknown): reference is PollElement => reference instanceof PollElement;
