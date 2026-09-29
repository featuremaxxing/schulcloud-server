import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { FileAreaFolder, type FileAreaFolderProps, ROOT_PATH } from '../domain';

export const fileAreaFolderFactory = BaseFactory.define<FileAreaFolder, FileAreaFolderProps>(
	FileAreaFolder,
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
