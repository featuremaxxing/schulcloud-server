import { ObjectId } from '@mikro-orm/mongodb';
import { InputFormat } from '@shared/domain/types';
import { type AssignmentElementProps, BoardNodeType, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const assignmentElementEntityFactory = BoardNodeEntityFactory.define<PropsWithType<AssignmentElementProps>>(
	({ sequence }) => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			title: `assignment #${sequence}`,
			text: `description #${sequence}`,
			inputFormat: InputFormat.RICH_TEXT_CK5,
			createdAt: new Date(),
			updatedAt: new Date(),
			type: BoardNodeType.ASSIGNMENT_ELEMENT,
		};
	}
);
