import { ObjectId } from '@mikro-orm/mongodb';
import { EntityFactory } from '@testing/factory/entity.factory';
import { AppPasswordEntity, type AppPasswordProps } from '../repo';

export const appPasswordEntityFactory = EntityFactory.define<AppPasswordEntity, AppPasswordProps>(
	AppPasswordEntity,
	({ sequence }) => {
		return {
			id: new ObjectId().toHexString(),
			userId: new ObjectId().toHexString(),
			name: `app password #${sequence}`,
			secretHash: '$2a$10$abcdefghijklmnopqrstuuYhZ0cCkQ7Sx5o1sQnXQ9D8Ms9R3m5ce',
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}
);
