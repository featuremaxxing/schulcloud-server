import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { LearningPathStep, type LearningPathStepProps, ROOT_PATH } from '../domain';

export const learningPathStepFactory = BaseFactory.define<LearningPathStep, LearningPathStepProps>(
	LearningPathStep,
	({ sequence }) => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			linkedBoardId: new ObjectId().toHexString(),
			positionX: sequence * 10,
			positionY: 0,
			prerequisiteStepIds: [],
			unlockMode: 'all',
			lockUntilPrerequisitesDone: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}
);
