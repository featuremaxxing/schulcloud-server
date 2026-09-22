import { ObjectId } from '@mikro-orm/mongodb';
import { type AssignmentFeedbackProps, BoardNodeType, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const assignmentFeedbackEntityFactory = BoardNodeEntityFactory.define<PropsWithType<AssignmentFeedbackProps>>(
	() => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			type: BoardNodeType.ASSIGNMENT_FEEDBACK,
		};
	}
);
