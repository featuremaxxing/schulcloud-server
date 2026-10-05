import { type RoomCollection } from '../../domain/type';
import { type RoomWithAllowedOperationsAndLockedStatus } from './room-with-locked-status';

export type RoomListWithCollections = {
	rooms: RoomWithAllowedOperationsAndLockedStatus[];
	collections: RoomCollection[];
};
