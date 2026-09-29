import { ObjectId } from '@mikro-orm/mongodb';
import { type AiQuestionElementProps, BoardNodeType, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const aiQuestionElementEntityFactory = BoardNodeEntityFactory.define<PropsWithType<AiQuestionElementProps>>(
	({ sequence }) => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			question: `ai question #${sequence}`,
			createdAt: new Date(),
			updatedAt: new Date(),
			type: BoardNodeType.AI_QUESTION_ELEMENT,
		};
	}
);
