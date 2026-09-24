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
	AiQuestionAnswer,
	AiQuestionElement,
	AssignmentElement,
	AssignmentFeedback,
	AssignmentRubricCriterion,
	AssignmentStatus,
	AssignmentSubmission,
	AssignmentSubmissionCriterionPoints,
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
	isAssignmentFeedback,
	isAssignmentSubmission,
	isAiQuestionAnswer,
	isAiQuestionElement,
	isColumnBoard,
	// modules/assignment/api/assignment.uc.ts
	isStudentMember,
	isTeacherMember,
	// @modules/tool/tool-launch/service/auto-parameter-strategy/auto-context-name.strategy.ts
	MediaBoard,
} from './domain';

// modules/assignment/api/assignment.uc.ts, peer-review.uc.ts
export {
	AssignmentReviewAssignmentMode,
	AssignmentReviewEntity,
	AssignmentReviewEntityProps,
	AssignmentReviewRepo,
} from './repo';

// modules/assignment/api/assignment.uc.ts
export { BoardNodeFactory } from './domain';
// modules/assignment/api/assignment.uc.ts
export { BoardNodeRule } from './authorisation/board-node.rule';
export {
	BoardCommonToolService,
	BoardNodeAuthorizableService,
	BoardNodeService,
	BoardProgressResult,
	BoardProgressService,
	BoardWithAuth,
	ColumnBoardService,
	ProgressItemResult,
	ProgressItemType,
	ProgressStudentResult,
} from './service';

// modules/room/api/room.controller.ts, room-content.uc.ts - the room-progress endpoint
// reuses the board module's progress DTOs/mapper instead of duplicating them.
export { ProgressQueryParams, RoomProgressResponse } from './controller/dto/progress';
export { ProgressResponseMapper } from './controller/mapper';
