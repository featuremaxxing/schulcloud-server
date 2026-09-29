import { pollVoteFactory } from '../testing';
import { isPollVote, PollVote } from './poll-vote.do';

describe(PollVote.name, () => {
	it('should be instance of PollVote', () => {
		const vote = pollVoteFactory.build();

		expect(isPollVote(vote)).toBe(true);
	});

	it('should not be instance of PollVote', () => {
		expect(isPollVote({})).toBe(false);
	});

	it('should never allow children', () => {
		const vote = pollVoteFactory.build();

		expect(vote.canHaveChild()).toBe(false);
	});

	it('should expose userId, votedAt and answers', () => {
		const votedAt = new Date('2026-01-10T10:00:00.000Z');
		const answers = [{ questionId: 'q1', selectedOptionIds: ['o1'] }];
		const vote = pollVoteFactory.build({ userId: 'user-1', votedAt, answers });

		expect(vote.userId).toBe('user-1');
		expect(vote.votedAt).toEqual(votedAt);
		expect(vote.answers).toEqual(answers);
	});
});
