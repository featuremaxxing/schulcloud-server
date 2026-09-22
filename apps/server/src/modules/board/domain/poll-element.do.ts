import { BoardNode } from './board-node.do';
import { type BoardRoles } from './board-node-authorizable.do';
import { isPollVote } from './poll-vote.do';
import type { AnyBoardNode, PollElementProps, PollQuestion, PollResultSnapshot } from './types';
import { PollAudience, PollStatus } from './types';

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

	get opensAt(): Date | undefined {
		return this.props.opensAt;
	}

	set opensAt(value: Date | undefined) {
		this.props.opensAt = value;
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

	// Defaults to STUDENTS - matches the poll's original, implicit behavior (only board
	// readers could vote) for every poll created before this field existed.
	get audience(): PollAudience {
		return this.props.audience ?? PollAudience.STUDENTS;
	}

	set audience(value: PollAudience) {
		this.props.audience = value;
	}

	get audienceRoles(): BoardRoles[] | undefined {
		return this.props.audienceRoles;
	}

	set audienceRoles(value: BoardRoles[] | undefined) {
		this.props.audienceRoles = value;
	}

	// Defaults to false - every poll created before this field existed keeps behaving exactly
	// as before: once a vote is cast, it's final unless a teacher explicitly opts back in.
	get allowVoteChange(): boolean {
		return this.props.allowVoteChange ?? false;
	}

	set allowVoteChange(value: boolean) {
		this.props.allowVoteChange = value;
	}

	// A poll only ever accepts votes while explicitly opened and, if a start/deadline is set,
	// within that window. Closing (or never opening) always wins over opensAt/closesAt.
	public isOpen(now: Date): boolean {
		if (this.pollStatus !== PollStatus.OPEN) {
			return false;
		}

		if (this.opensAt && now.getTime() < this.opensAt.getTime()) {
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
