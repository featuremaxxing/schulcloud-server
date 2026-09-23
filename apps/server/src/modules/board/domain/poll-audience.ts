import { type UserWithBoardRoles } from './board-node-authorizable.do';
import { isStudentMember, isTeacherMember } from './member-role';
import { type PollElement } from './poll-element.do';
import { type CheckboxElement } from './checkbox-element.do';
import { PollAudience } from './types';

// Single source of truth for "who is eligible to vote in this poll", shared by the
// authorisation rule (createOwnPollVote/updateOwnPollVote), PollUc.getParticipantCount and
// the result-snapshot builder that freezes participantCount at close time - all three must
// agree, or the "n of m voted" status bar and the actual voting gate drift apart (see U1).
export const isEligibleVoter = (element: PollElement | CheckboxElement, member: UserWithBoardRoles): boolean => {
	switch (element.audience) {
		case PollAudience.STUDENTS:
			return isStudentMember(member);
		case PollAudience.TEACHERS:
			return isTeacherMember(member);
		case PollAudience.ALL:
			// every member with at least read access to the board - board roles are always
			// READER/EDITOR/ADMIN once assigned, so "has any role" is "is a board reader" too
			return member.roles.length > 0;
		case PollAudience.CUSTOM:
			return (element.audienceRoles ?? []).some((role) => member.roles.includes(role));
		default:
			return false;
	}
};

export const countEligibleVoters = (element: PollElement, users: UserWithBoardRoles[]): number =>
	users.filter((member) => isEligibleVoter(element, member)).length;
