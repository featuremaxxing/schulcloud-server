import { type EntityId } from '@shared/domain/types';

export interface RoomArrangementItem {
	id: EntityId;
	tagIds?: EntityId[];
}

export interface RoomTag {
	id: EntityId;
	name: string;
}

export interface RoomArrangementProps {
	userId: EntityId;
	items: RoomArrangementItem[];
	tags?: RoomTag[];
}

export interface RoomArrangement {
	items: RoomArrangementItem[];
	tags: RoomTag[];
}
