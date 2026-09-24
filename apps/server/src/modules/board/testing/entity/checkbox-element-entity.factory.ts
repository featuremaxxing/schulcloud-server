import { ObjectId } from '@mikro-orm/mongodb';
import { BoardNodeType, type CheckboxElementProps, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from './board-node-entity.factory';

export const checkboxElementEntityFactory = BoardNodeEntityFactory.define<PropsWithType<CheckboxElementProps>>(
	({ sequence }) => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			text: `checkbox #${sequence}`,
			requireTeacherConfirmation: false,
			entries: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			type: BoardNodeType.CHECKBOX_ELEMENT,
		};
	}
);
