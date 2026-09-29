import {
	type BoardConfiguration,
	type BoardExternalReferenceType,
	type ColumnBoard,
	type MediaBoard,
	type UserWithBoardRoles,
} from '../../../domain';

/**
 * PreparedBoardContext holds context data needed for board operations. getBoardConfiguration is
 * synchronous (its data is loaded upfront during construction); getUsersWithBoardRoles is async
 * because at least one implementation (RoomBoardContext) defers its own, separate DB round-trip
 * (user names/school roles) until this is actually called - most board operations never need it
 * (see board-node-authorizable.service.ts, which runs on every board access).
 *
 * Use BoardContextResolver to create instances of PreparedBoardContext.
 */
export interface PreparedBoardContext {
	readonly type: BoardExternalReferenceType;

	/**
	 * Returns users with their board roles.
	 */
	getUsersWithBoardRoles(): Promise<UserWithBoardRoles[]>;

	/**
	 * Computes board configuration based on the root node (sync - uses pre-fetched data).
	 */
	getBoardConfiguration(rootNode: MediaBoard | ColumnBoard): BoardConfiguration;
}
