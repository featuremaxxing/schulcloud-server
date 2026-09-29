import { ObjectId } from '@mikro-orm/mongodb';
import { ROOT_PATH } from './path-utils';
import { FileAreaLinkElement } from './file-area-link-element.do';

describe(FileAreaLinkElement.name, () => {
	const build = () =>
		new FileAreaLinkElement({
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			title: '',
			createdAt: new Date(),
			updatedAt: new Date(),
		});

	it('should set and clear the target', () => {
		const element = build();

		element.setTarget({ fileAreaId: 'area', targetType: 'folder', targetId: 'folder', title: 'Material' });
		expect([element.fileAreaId, element.targetType, element.targetId, element.title]).toEqual([
			'area',
			'folder',
			'folder',
			'Material',
		]);

		element.clearTarget();
		expect([element.fileAreaId, element.targetType, element.targetId]).toEqual([undefined, undefined, undefined]);
		expect(element.title).toEqual('Material');
	});

	it('should not have children', () => {
		expect(build().canHaveChild()).toBe(false);
	});
});
