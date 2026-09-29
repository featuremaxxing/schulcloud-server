import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { type CheckboxElementProps, ROOT_PATH } from '../domain';
import { CheckboxElement } from '../domain/checkbox-element.do';

export const checkboxElementFactory = BaseFactory.define<CheckboxElement, CheckboxElementProps>(
	CheckboxElement,
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
		};
	}
);
