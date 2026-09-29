import { ObjectId } from '@mikro-orm/mongodb';
import { RoleName } from '@modules/role';
import { assignmentElementFactory } from '../testing/assignment-element.factory';
import { assignmentSubmissionFactory } from '../testing/assignment-submission.factory';
import { pollElementFactory } from '../testing/poll-element.factory';
import { pollVoteFactory } from '../testing/poll-vote.factory';
import { type UserWithBoardRoles, BoardRoles } from './board-node-authorizable.do';
import { CheckboxElement } from './checkbox-element.do';
import { ROOT_PATH } from './path-utils';
import { PollAudience, PollStatus } from './types';
import { computeItemProgress, summarize } from './progress';

const teacherId = new ObjectId().toHexString();
const studentId = new ObjectId().toHexString();
const otherStudentId = new ObjectId().toHexString();

const teacherMember: UserWithBoardRoles = {
	userId: teacherId,
	roles: [BoardRoles.EDITOR],
	schoolRoleNames: [RoleName.TEACHER],
};
const studentMember: UserWithBoardRoles = {
	userId: studentId,
	roles: [BoardRoles.READER],
	schoolRoleNames: [RoleName.STUDENT],
};
const otherStudentMember: UserWithBoardRoles = {
	userId: otherStudentId,
	roles: [BoardRoles.READER],
	schoolRoleNames: [RoleName.STUDENT],
};
const members = [teacherMember, studentMember, otherStudentMember];

const buildCheckbox = (props: Partial<ConstructorParameters<typeof CheckboxElement>[0]> = {}) =>
	new CheckboxElement({
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		text: 'Task',
		requireTeacherConfirmation: false,
		creatorId: teacherId,
		entries: [],
		...props,
	});

describe('computeItemProgress', () => {
	describe('checkbox element', () => {
		it('excludes the creator from eligible users', () => {
			const checkbox = buildCheckbox();
			const result = computeItemProgress(checkbox, [], members);
			expect(result?.eligibleUserIds.sort()).toEqual([studentId, otherStudentId].sort());
		});

		it('counts a checked entry as done without confirmation required', () => {
			const checkbox = buildCheckbox({ entries: [{ userId: studentId, checked: true, approved: false }] });
			const result = computeItemProgress(checkbox, [], members);
			expect(result?.doneUserIds).toEqual([studentId]);
		});

		it('requires approval when requireTeacherConfirmation is set', () => {
			const checkbox = buildCheckbox({
				requireTeacherConfirmation: true,
				entries: [{ userId: studentId, checked: true, approved: false }],
			});
			const result = computeItemProgress(checkbox, [], members);
			expect(result?.doneUserIds).toEqual([]);
		});

		it('counts a checked and approved entry as done when confirmation is required', () => {
			const checkbox = buildCheckbox({
				requireTeacherConfirmation: true,
				entries: [{ userId: studentId, checked: true, approved: true }],
			});
			const result = computeItemProgress(checkbox, [], members);
			expect(result?.doneUserIds).toEqual([studentId]);
		});

		it('respects a custom audience', () => {
			const checkbox = buildCheckbox({ audience: PollAudience.TEACHERS });
			const result = computeItemProgress(checkbox, [], members);
			// the teacher is the creator and therefore excluded despite matching the audience
			expect(result?.eligibleUserIds).toEqual([]);
		});
	});

	describe('assignment element', () => {
		it('is eligible for students only and done once submitted', () => {
			const element = assignmentElementFactory.build();
			const submission = assignmentSubmissionFactory.build({ userId: studentId, submittedAt: new Date() });
			const result = computeItemProgress(element, [submission], members);
			expect(result?.eligibleUserIds.sort()).toEqual([studentId, otherStudentId].sort());
			expect(result?.doneUserIds).toEqual([studentId]);
		});

		it('treats an open (unsubmitted) submission as not done', () => {
			const element = assignmentElementFactory.build();
			const submission = assignmentSubmissionFactory.build({ userId: studentId });
			const result = computeItemProgress(element, [submission], members);
			expect(result?.doneUserIds).toEqual([]);
		});
	});

	describe('poll element', () => {
		it('returns null for a draft poll', () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.DRAFT });
			expect(computeItemProgress(element, [], members)).toBeNull();
		});

		it('counts an existing vote as done for an open poll', () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.OPEN, audience: PollAudience.STUDENTS });
			const vote = pollVoteFactory.build({ userId: studentId });
			const result = computeItemProgress(element, [vote], members);
			expect(result?.eligibleUserIds.sort()).toEqual([studentId, otherStudentId].sort());
			expect(result?.doneUserIds).toEqual([studentId]);
		});

		it('still counts a closed poll', () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.CLOSED, audience: PollAudience.STUDENTS });
			const result = computeItemProgress(element, [], members);
			expect(result?.eligibleUserIds.sort()).toEqual([studentId, otherStudentId].sort());
			expect(result?.doneUserIds).toEqual([]);
		});
	});
});

describe('summarize', () => {
	it('sums eligible and done users across items', () => {
		const result = summarize([
			{ eligibleUserIds: ['a', 'b'], doneUserIds: ['a'] },
			{ eligibleUserIds: ['a'], doneUserIds: [] },
		]);
		expect(result).toEqual({ done: 1, total: 3 });
	});

	it('returns 0/0 for an empty list', () => {
		expect(summarize([])).toEqual({ done: 0, total: 0 });
	});
});
