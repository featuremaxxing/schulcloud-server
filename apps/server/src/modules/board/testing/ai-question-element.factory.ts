import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { type AiQuestionElementProps, ROOT_PATH } from '../domain';
import { AiQuestionElement } from '../domain/ai-question-element.do';

export const aiQuestionElementFactory = BaseFactory.define<AiQuestionElement, AiQuestionElementProps>(
	AiQuestionElement,
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
		};
	}
);
