import { ObjectId } from '@mikro-orm/mongodb';
import { type AssignmentSubmissionProps, BoardNodeType, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const assignmentSubmissionEntityFactory = BoardNodeEntityFactory.define<
	PropsWithType<AssignmentSubmissionProps>
>(() => {
	return {
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		userId: new ObjectId().toHexString(),
		createdAt: new Date(),
		updatedAt: new Date(),
		type: BoardNodeType.ASSIGNMENT_SUBMISSION,
	};
});
