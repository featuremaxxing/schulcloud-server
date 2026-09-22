import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { type AiQuestionAnswerProps, ROOT_PATH } from '../domain';
import { AiQuestionAnswer } from '../domain/ai-question-answer.do';

export const aiQuestionAnswerFactory = BaseFactory.define<AiQuestionAnswer, AiQuestionAnswerProps>(
	AiQuestionAnswer,
	() => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			userId: new ObjectId().toHexString(),
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}
);
