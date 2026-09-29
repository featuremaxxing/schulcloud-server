import { ObjectId } from '@mikro-orm/mongodb';
import { BoardNodeType, type FileAreaFolderProps, ROOT_PATH } from '../../domain';
import { BoardNodeEntityFactory, type PropsWithType } from '../entity/board-node-entity.factory';

export const fileAreaFolderEntityFactory = BoardNodeEntityFactory.define<PropsWithType<FileAreaFolderProps>>(
	({ sequence }) => {
		const props: PropsWithType<FileAreaFolderProps> = {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			title: `title #${sequence}`,
			createdAt: new Date(),
			updatedAt: new Date(),
			type: BoardNodeType.FILE_AREA_FOLDER,
		};

		return props;
	}
);
