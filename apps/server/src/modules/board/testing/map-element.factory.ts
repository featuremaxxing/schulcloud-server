import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { MapElement, type MapElementProps, ROOT_PATH } from '../domain';

export const mapElementFactory = BaseFactory.define<MapElement, MapElementProps>(MapElement, () => {
	return {
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		latitude: 52.37,
		longitude: 9.73,
		zoom: 12,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
});
