import { type EntityId } from '@shared/domain/types';

export interface RoomArrangementItem {
	id: EntityId;
	collectionId?: string;
}

export interface RoomCollection {
	id: string;
	title: string;
}

export interface RoomArrangementProps {
	userId: EntityId;
	items: RoomArrangementItem[];
	collections?: RoomCollection[];
}

export interface RoomArrangement {
	items: RoomArrangementItem[];
	collections: RoomCollection[];
}
