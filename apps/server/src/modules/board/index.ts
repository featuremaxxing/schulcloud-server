/** **********************************************************
 * This is a module facade.                                  *
 * Export only what is allowed to be used externally.        *
 * Do not use wildcard exports.                              *
 * Do not export *.app.module.ts here; import them directly. *
 *********************************************************** */

export { BOARD_PUBLIC_API_CONFIG_TOKEN, BoardPublicApiConfig } from './board.config';
export { BoardModule } from './board.module';
export {
	AnyBoardNode,
	AssignmentElement,
	AssignmentStatus,
	AssignmentSubmission,
	BoardExternalReference,
	BoardExternalReferenceType,
	BoardLayout,
	BoardNodeAuthorizable,
	BoardNodeType,
	// @modules/authorization/domain/rules/board-node.rule.ts
	BoardRoles,
	Card,
	Column,
	ColumnBoard,
	isAssignmentElement,
	isAssignmentSubmission,
	isColumnBoard,
	// @modules/tool/tool-launch/service/auto-parameter-strategy/auto-context-name.strategy.ts
	MediaBoard,
} from './domain';

// modules/assignment/api/assignment.uc.ts
export { BoardNodeFactory } from './domain';
// modules/assignment/api/assignment.uc.ts
export { BoardNodeRule } from './authorisation/board-node.rule';
export { BoardCommonToolService, BoardNodeAuthorizableService, BoardNodeService, ColumnBoardService } from './service';
