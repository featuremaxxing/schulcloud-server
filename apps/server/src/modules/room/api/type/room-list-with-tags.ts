import { type RoomTag } from '../../domain/type';
import { type RoomWithAllowedOperationsAndLockedStatus } from './room-with-locked-status';

export type RoomListWithTags = {
	rooms: RoomWithAllowedOperationsAndLockedStatus[];
	tags: RoomTag[];
};
