import { type UserWithBoardRoles } from './board-node-authorizable.do';
import { isAssignmentElement } from './assignment-element.do';
import { type AssignmentSubmission } from './assignment-submission.do';
import { AssignmentStatus } from './assignment-status.enum';
import { isCheckboxElement } from './checkbox-element.do';
import { isStudentMember } from './member-role';
import { isPollElement } from './poll-element.do';
import { type PollVote } from './poll-vote.do';
import { isEligibleVoter } from './poll-audience';
import { PollStatus, type AnyContentElement } from './types';

export interface ItemProgress {
	eligibleUserIds: string[];
	doneUserIds: string[];
}

// Single source of truth for "who is eligible for this item" and "who has completed it",
// shared by the board- and room-progress services (student view sums this per person,
// teacher view sums it per item). Returns null for items that never count towards
// progress at all (e.g. a poll still in draft) rather than one with 0 eligible users,
// so callers can drop them instead of showing a 0/0 bar.
export const computeItemProgress = (
	element: AnyContentElement,
	children: (AssignmentSubmission | PollVote)[],
	members: UserWithBoardRoles[]
): ItemProgress | null => {
	if (isCheckboxElement(element)) {
		// The creator (teacher who authored the checkbox) is never an eligible voter for
		// their own checkbox - same rule as CheckboxUc.state().
		const eligible = members.filter(
			(member) => member.userId !== element.creatorId && isEligibleVoter(element, member)
		);
		const doneUserIds = element.entries
			.filter((entry) => entry.checked && (!element.requireTeacherConfirmation || entry.approved))
			.map((entry) => entry.userId);
		return {
			eligibleUserIds: eligible.map((member) => member.userId),
			doneUserIds,
		};
	}

	if (isAssignmentElement(element)) {
		const eligible = members.filter(isStudentMember);
		const submissions = children.filter((child): child is AssignmentSubmission => 'getStatus' in child);
		const doneUserIds = submissions
			.filter((submission) => submission.getStatus() !== AssignmentStatus.OPEN)
			.map((submission) => submission.userId);
		return {
			eligibleUserIds: eligible.map((member) => member.userId),
			doneUserIds,
		};
	}

	if (isPollElement(element)) {
		// A poll still in draft has no meaningful audience yet and must not appear as an
		// (always empty) 0/n bar - it simply does not count towards progress until opened.
		if (element.pollStatus === PollStatus.DRAFT) {
			return null;
		}
		const eligible = members.filter((member) => isEligibleVoter(element, member));
		const votes = children.filter((child): child is PollVote => 'votedAt' in child);
		return {
			eligibleUserIds: eligible.map((member) => member.userId),
			doneUserIds: votes.map((vote) => vote.userId),
		};
	}

	return null;
};

export interface ProgressSummary {
	done: number;
	total: number;
}

export const summarize = (progresses: ItemProgress[]): ProgressSummary => {
	const total = progresses.reduce((sum, item) => sum + item.eligibleUserIds.length, 0);
	const done = progresses.reduce((sum, item) => sum + item.doneUserIds.length, 0);
	return { done, total };
};
