import { ObjectId } from '@mikro-orm/mongodb';
import { BoardNodeType, type LearningPathStepProps, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from '../entity/board-node-entity.factory';

export const learningPathStepEntityFactory = BoardNodeEntityFactory.define<PropsWithType<LearningPathStepProps>>(
	({ sequence }) => {
		const props: PropsWithType<LearningPathStepProps> = {
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
			type: BoardNodeType.LEARNING_PATH_STEP,
		};

		return props;
	}
);
