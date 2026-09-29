import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { type PollVoteProps, ROOT_PATH } from '../domain';
import { PollVote } from '../domain/poll-vote.do';

export const pollVoteFactory = BaseFactory.define<PollVote, PollVoteProps>(PollVote, () => {
	return {
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		userId: new ObjectId().toHexString(),
		answers: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
});
