import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { FileAreaLinkElement, type FileAreaLinkElementProps, ROOT_PATH } from '../domain';

export const fileAreaLinkElementFactory = BaseFactory.define<FileAreaLinkElement, FileAreaLinkElementProps>(
	FileAreaLinkElement,
	({ sequence }) => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			title: `title #${sequence}`,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}
);
