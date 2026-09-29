import { ObjectId } from '@mikro-orm/mongodb';
import { cardFactory, columnFactory } from '../testing';
import { canManageCheckboxDescendants, CheckboxElement } from './checkbox-element.do';
import { ROOT_PATH } from './path-utils';

describe('canManageCheckboxDescendants', () => {
	const ownerId = new ObjectId().toHexString();
	const otherId = new ObjectId().toHexString();
	const checkbox = new CheckboxElement({
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		creatorId: ownerId,
		text: 'Task',
		requireTeacherConfirmation: false,
		entries: [],
	});
	const card = cardFactory.build({ children: [checkbox] });
	const column = columnFactory.build({ children: [card] });

	it('allows deleting an empty parent without checkbox descendants', () => {
		expect(canManageCheckboxDescendants(cardFactory.build(), otherId)).toBe(true);
	});

	it('forbids a nonowner from deleting a card or column containing the checkbox', () => {
		expect(canManageCheckboxDescendants(card, otherId)).toBe(false);
		expect(canManageCheckboxDescendants(column, otherId)).toBe(false);
	});

	it('allows the creator to manage the checkbox through its parent', () => {
		expect(canManageCheckboxDescendants(card, ownerId)).toBe(true);
		expect(canManageCheckboxDescendants(column, ownerId)).toBe(true);
	});
});
