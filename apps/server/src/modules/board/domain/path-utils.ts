import { type EntityId } from '@shared/domain/types';

export const ROOT_PATH = ',';

export const joinPath = (path: string, id: EntityId): string => `${path}${id}${ROOT_PATH}`;

export const pathOfChildren = (props: { id: EntityId; path: string }): string => joinPath(props.path, props.id);

// A node's own path is ',<ancestorId1>,<ancestorId2>,...,' (ROOT_PATH=','). Index 0 is the
// board, 1 the column, 2 the card, etc. - shared by every caller that needs to derive a
// deep-linkable board/card id from an element's path instead of an extra parent lookup.
export const pathSegmentOf = (node: { path: string }, index: number): EntityId | undefined =>
	node.path.split(',').filter(Boolean)[index];
