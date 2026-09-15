import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { InputFormat } from '@shared/domain/types';
import { type AssignmentElementProps, ROOT_PATH } from '../domain';
import { AssignmentElement } from '../domain/assignment-element.do';

export const assignmentElementFactory = BaseFactory.define<AssignmentElement, AssignmentElementProps>(
	AssignmentElement,
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
		};
	}
);
