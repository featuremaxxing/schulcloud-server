/* istanbul ignore file */
import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { PinnedCard, type PinnedCardProps, ROOT_PATH } from '../domain';

export const pinnedCardFactory = BaseFactory.define<PinnedCard, PinnedCardProps>(PinnedCard, () => {
	const props: PinnedCardProps = {
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		referencedCardId: new ObjectId().toHexString(),
	};

	return props;
});
