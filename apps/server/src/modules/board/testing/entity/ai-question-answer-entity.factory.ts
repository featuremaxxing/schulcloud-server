import { ObjectId } from '@mikro-orm/mongodb';
import { type AiQuestionAnswerProps, BoardNodeType, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const aiQuestionAnswerEntityFactory = BoardNodeEntityFactory.define<PropsWithType<AiQuestionAnswerProps>>(() => {
	return {
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		userId: new ObjectId().toHexString(),
		createdAt: new Date(),
		updatedAt: new Date(),
		type: BoardNodeType.AI_QUESTION_ANSWER,
	};
});
