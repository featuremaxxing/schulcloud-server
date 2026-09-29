import { pollElementFactory } from '../testing/poll-element.factory';
import { BoardRoles, type UserWithBoardRoles } from './board-node-authorizable.do';
import { countEligibleVoters, isEligibleVoter } from './poll-audience';
import { PollAudience } from './types';

const member = (props: Partial<UserWithBoardRoles>): UserWithBoardRoles => {
	return {
		userId: 'user-1',
		roles: [],
		...props,
	};
};

describe('isEligibleVoter', () => {
	describe('when audience is STUDENTS (the default)', () => {
		it('should be true for a student and false for a teacher', () => {
			const element = pollElementFactory.build({ audience: PollAudience.STUDENTS });

			expect(isEligibleVoter(element, member({ roles: [BoardRoles.READER] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [BoardRoles.EDITOR] }))).toBe(false);
		});

		it('should be the default when audience is unset', () => {
			const element = pollElementFactory.build({ audience: undefined });

			expect(isEligibleVoter(element, member({ roles: [BoardRoles.READER] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [BoardRoles.EDITOR] }))).toBe(false);
		});
	});

	describe('when audience is TEACHERS', () => {
		it('should be true for a teacher and false for a student', () => {
			const element = pollElementFactory.build({ audience: PollAudience.TEACHERS });

			expect(isEligibleVoter(element, member({ roles: [BoardRoles.EDITOR] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [BoardRoles.READER] }))).toBe(false);
		});
	});

	describe('when audience is ALL', () => {
		it('should be true for any member with a board role', () => {
			const element = pollElementFactory.build({ audience: PollAudience.ALL });

			expect(isEligibleVoter(element, member({ roles: [BoardRoles.READER] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [BoardRoles.EDITOR] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [] }))).toBe(false);
		});
	});

	describe('when audience is CUSTOM', () => {
		it('should be true only for members with one of the configured audienceRoles', () => {
			const element = pollElementFactory.build({
				audience: PollAudience.CUSTOM,
				audienceRoles: [BoardRoles.READER, BoardRoles.EDITOR],
			});

			expect(isEligibleVoter(element, member({ roles: [BoardRoles.READER] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [BoardRoles.EDITOR] }))).toBe(true);
			expect(isEligibleVoter(element, member({ roles: [BoardRoles.ADMIN] }))).toBe(false);
		});

		it('should be false for everyone when audienceRoles is empty/unset', () => {
			const element = pollElementFactory.build({ audience: PollAudience.CUSTOM, audienceRoles: undefined });

			expect(isEligibleVoter(element, member({ roles: [BoardRoles.READER] }))).toBe(false);
		});
	});
});

describe('countEligibleVoters', () => {
	it('should count only the eligible members', () => {
		const element = pollElementFactory.build({ audience: PollAudience.STUDENTS });
		const users = [
			member({ userId: 'student-1', roles: [BoardRoles.READER] }),
			member({ userId: 'student-2', roles: [BoardRoles.READER] }),
			member({ userId: 'teacher-1', roles: [BoardRoles.EDITOR] }),
		];

		expect(countEligibleVoters(element, users)).toBe(2);
	});
});
