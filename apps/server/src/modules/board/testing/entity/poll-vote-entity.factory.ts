import { ObjectId } from '@mikro-orm/mongodb';
import { BoardNodeType, type PollVoteProps, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const pollVoteEntityFactory = BoardNodeEntityFactory.define<PropsWithType<PollVoteProps>>(() => {
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
		type: BoardNodeType.POLL_VOTE,
	};
});
