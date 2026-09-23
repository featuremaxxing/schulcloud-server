import { Action, AuthorizationContext, AuthorizationInjectionService, Rule } from '@modules/authorization';
import { UserService } from '@modules/user';
import { type User } from '@modules/user/repo';
import { Injectable } from '@nestjs/common';
import { Permission } from '@shared/domain/interface';
import {
	type AssignmentSubmission,
	BoardNodeAuthorizable,
	BoardRoles,
	ColumnBoard,
	isAssignmentElement,
	isAssignmentFeedback,
	isAssignmentSubmission,
	isAiQuestionAnswer,
	isAiQuestionElement,
	isDrawingElement,
	isEligibleVoter,
	isPollElement,
	isPollVote,
	isStudentMember,
	isTeacherMember,
	isVideoConferenceElement,
	MediaBoard,
	UserWithBoardRoles,
} from '../domain';

export const BoardOperationValues = [
	// board
	'copyBoard',
	'deleteBoard',
	'findBoard',
	'relocateContent',
	'shareBoard',
	'updateBoardLayout',
	'updateBoardTitle',
	'updateReadersCanEditSetting',
	// True board-edit permission, independent of the readersCanEdit collaboration toggle - see
	// isBoardEditor below and the assignment/poll carve-out in _canEditBoard/hasPermission().
	'isBoardEditor',

	// column
	'copyColumn',
	'createColumn',
	'deleteColumn',
	'moveColumn',
	'shareColumn',
	'updateColumnTitle',

	// card
	'copyCard',
	'createCard',
	'deleteCard',
	'findCards',
	'moveCard',
	'shareCard',
	'updateCardHeight',
	'updateCardTitle',
	'updateCardColor',

	// element
	'createElement',
	'deleteElement',
	'moveElement',
	'updateElement',
	'viewElement',

	// element / externalToolElement
	'createExternalToolElement',

	// element / fileElement
	'createFileElement',

	// element / videoConferenceElement
	'manageVideoConference',

	// element / pollElement
	'createOwnPollVote',
	'updateOwnPollVote',
	'viewPollResults',
	'managePoll',

	// element / assignmentElement
	'viewAssignmentSubmissions',
	'createOwnAssignmentSubmission',
	'updateOwnAssignmentSubmission',
	'deleteOwnAssignmentSubmission',
	'gradeAssignmentSubmission',

	// element / aiQuestionElement
	'manageAiQuestion',
	'createOwnAiQuestionAnswer',
	'updateOwnAiQuestionAnswer',

	// mediaBoard
	'collapseMediaBoard',
	'updateBoardVisibility',
	'updateMediaBoardColor',
	'updateMediaBoardLayout',
	'viewMediaBoard',

	// mediaBoardLine
	'collapseMediaBoardLine',
	'createMediaBoardLine',
	'deleteMediaBoardLine',
	'updateMediaBoardLine',
	'updateMediaBoardLineColor',
] as const;

export type BoardOperation = (typeof BoardOperationValues)[number]; // turn string list to type union of strings

type OperationFn = (user: User, authorizable: BoardNodeAuthorizable) => boolean;

@Injectable()
export class BoardNodeRule implements Rule<BoardNodeAuthorizable> {
	constructor(
		authorisationInjectionService: AuthorizationInjectionService,
		private readonly userService: UserService
	) {
		authorisationInjectionService.injectAuthorizationRule(this);
	}

	public isApplicable(user: User, object: unknown): boolean {
		const isMatched = object instanceof BoardNodeAuthorizable;

		return isMatched;
	}

	public hasPermission(user: User, authorizable: BoardNodeAuthorizable, context: AuthorizationContext): boolean {
		if (authorizable.boardConfiguration.isLocked) {
			return false;
		}

		const hasAllPermissions = this.hasAllPermissions(user, authorizable, context.requiredPermissions);
		if (!hasAllPermissions) {
			return false;
		}

		const userWithBoardRoles = authorizable.users.find(({ userId }) => userId === user.id);
		if (!userWithBoardRoles) {
			return false;
		}

		if (
			authorizable.rootNode instanceof ColumnBoard &&
			!authorizable.rootNode.isVisible &&
			!this.isBoardEditor(userWithBoardRoles)
		) {
			return false;
		}

		if (this.shouldProcessDrawingElementFile(authorizable, context)) {
			return this.hasPermissionForDrawingElementFile(userWithBoardRoles);
		}

		if (this.shouldProcessVideoConferenceElement(authorizable)) {
			return this.hasPermissionForVideoConferenceElement(userWithBoardRoles, context, authorizable);
		}

		if (this.shouldProcessAssignmentSubmissionFile(authorizable, context)) {
			return this.hasPermissionForAssignmentSubmissionFile(userWithBoardRoles, authorizable, context);
		}

		if (this.shouldProcessAssignmentFeedbackFile(authorizable, context)) {
			return this.hasPermissionForAssignmentFeedbackFile(userWithBoardRoles, authorizable, context);
		}

		if (context.action === Action.write) {
			const isReader = userWithBoardRoles.roles.includes(BoardRoles.READER);
			const readersCanEdit = authorizable.boardConfiguration.canReadersEdit ?? false;

			// Same reasoning as the carve-out in _canEditBoard below: a poll's questions, status
			// and deadline, and an assignment's due date/grace period/points, are configuration
			// with real consequences, so the readersCanEdit collaboration toggle must never let a
			// student write here. This is a SEPARATE relaxation from the one in _canEditBoard -
			// hasPermission() is its own Rule-interface entry point (used by e.g. file-storage's
			// generic checkPermissionsByReference), not routed through _canEditBoard, so it needs
			// its own guard.
			const isPollNode = isPollElement(authorizable.boardNode) || isPollVote(authorizable.boardNode);
			const isAssignmentNode =
				isAssignmentElement(authorizable.boardNode) ||
				isAssignmentSubmission(authorizable.boardNode) ||
				isAssignmentFeedback(authorizable.boardNode);
			const isAiQuestionNode =
				isAiQuestionElement(authorizable.boardNode) || isAiQuestionAnswer(authorizable.boardNode);

			const requiredBoardPermission =
				isReader && readersCanEdit && !isPollNode && !isAssignmentNode && !isAiQuestionNode
					? Permission.BOARD_VIEW
					: Permission.BOARD_EDIT;
			const writePermissions = Array.from(new Set([requiredBoardPermission, ...context.requiredPermissions]));
			return this.hasAllPermissions(user, authorizable, writePermissions);
		}

		return this.isBoardReader(userWithBoardRoles);
	}

	private hasAllPermissions(
		user: User,
		authorizable: BoardNodeAuthorizable,
		requiredPermissions: Permission[]
	): boolean {
		const schoolPermissions: Permission[] = this.userService.resolvePermissions(user);
		const boardPermissions = authorizable.getUserPermissions(user.id);

		const permissions = Array.from(new Set([...schoolPermissions, ...boardPermissions]));
		return requiredPermissions.every((p) => permissions.includes(p));
	}

	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	public getOperationMap() {
		const map = {
			// board
			copyBoard: _canManageBoard,
			deleteBoard: _canManageBoard,
			findBoard: canFindBoard,
			relocateContent: canRelocateContent,
			shareBoard: canShareBoardNode,
			updateBoardLayout: _canManageBoard,
			updateBoardTitle: canEditBoardTitle,
			updateReadersCanEditSetting: canUpdateReadersCanEditSetting,
			isBoardEditor: _isBoardEditor,

			// column
			copyColumn: _canEditBoard,
			createColumn: _canEditBoard,
			deleteColumn: _canEditBoard,
			moveColumn: _canEditBoard,
			shareColumn: canShareBoardNode,
			updateColumnTitle: _canEditBoard,

			// card
			copyCard: _canEditBoard,
			createCard: _canEditBoard,
			deleteCard: _canEditBoard,
			findCards: _canViewBoard,
			moveCard: _canEditBoard,
			shareCard: canShareBoardNode,
			updateCardHeight: _canEditBoard,
			updateCardTitle: _canEditBoard,
			updateCardColor: _canEditBoard,

			// element
			createElement: _canEditBoard,
			deleteElement: _canEditBoard,
			moveElement: _canEditBoard,
			updateElement: _canEditBoard,
			viewElement: _canViewBoard,

			// element / externalToolElement
			createExternalToolElement: _canCreateExternalToolElement,

			// element / fileElement
			createFileElement: _canEditBoard,

			// element / videoConferenceElement
			manageVideoConference: canManageVideoConference,

			// element / pollElement
			createOwnPollVote: _canVoteInPoll,
			updateOwnPollVote: _isOwnPollVote,
			viewPollResults: _canViewBoard,
			managePoll: _canEditBoard,

			// element / assignmentElement
			// Deliberately room-role-based, not per-teacher-ownership: every teacher with
			// board-edit rights in the room is equally entitled to see and grade every
			// submission (covers co-teaching and substitution without a second rights
			// model). Accountability when a room has multiple teachers comes from
			// recording+displaying who graded a submission (AssignmentSubmissionEntry.gradedBy),
			// not from restricting access.
			viewAssignmentSubmissions: _canViewBoard,
			createOwnAssignmentSubmission: _isPlainBoardReader,
			updateOwnAssignmentSubmission: _isOwnAssignmentSubmission,
			deleteOwnAssignmentSubmission: _isOwnAssignmentSubmission,
			gradeAssignmentSubmission: _canEditBoard,

			// element / aiQuestionElement
			// Real board-edit check, same reasoning as gradeAssignmentSubmission above: every
			// teacher with board-edit rights may read the config (instructions, expected
			// answer) and every answer given - the readersCanEdit toggle must never grant that.
			manageAiQuestion: _canManageAiQuestion,
			createOwnAiQuestionAnswer: _isPlainBoardReader,
			updateOwnAiQuestionAnswer: _isOwnAiQuestionAnswer,

			// mediaBoard
			collapseMediaBoard: _canManageBoard,
			updateBoardVisibility: _canManageBoard,
			updateMediaBoardColor: _canEditBoard,
			updateMediaBoardLayout: _canManageBoard,
			viewMediaBoard: _canViewBoard,

			// mediaBoardLine
			collapseMediaBoardLine: _canEditBoard,
			createMediaBoardLine: _canEditBoard,
			deleteMediaBoardLine: _canEditBoard,
			updateMediaBoardLine: _canEditBoard,
			updateMediaBoardLineColor: _canEditBoard,
		} satisfies Record<BoardOperation, OperationFn>;

		return map;
	}

	public listAllowedOperations(user: User, authorizable: BoardNodeAuthorizable): Record<BoardOperation, boolean> {
		const list: Record<BoardOperation, boolean> = {} as Record<BoardOperation, boolean>;
		const map = this.getOperationMap();
		const operations = Object.keys(map) as BoardOperation[];

		for (const operation of operations) {
			const fn = map[operation];
			list[operation] = fn(user, authorizable);
		}

		return list;
	}

	public can(operation: BoardOperation, user: User, authorizable: BoardNodeAuthorizable): boolean {
		const canFunction = this.getOperationMap()[operation];

		const can = canFunction(user, authorizable);

		return can;
	}

	private isBoardAdmin(userWithBoardRoles: UserWithBoardRoles): boolean {
		return userWithBoardRoles.roles.includes(BoardRoles.ADMIN);
	}

	private isBoardEditor(userWithBoardRoles: UserWithBoardRoles): boolean {
		return userWithBoardRoles.roles.includes(BoardRoles.EDITOR);
	}

	private isBoardReader(userWithBoardRoles: UserWithBoardRoles): boolean {
		return [BoardRoles.READER, BoardRoles.EDITOR].some((role) => userWithBoardRoles.roles.includes(role));
	}

	private shouldProcessDrawingElementFile(
		boardNodeAuthorizable: BoardNodeAuthorizable,
		context: AuthorizationContext
	): boolean {
		const requiresFileStoragePermission =
			context.requiredPermissions.includes(Permission.FILESTORAGE_CREATE) ||
			context.requiredPermissions.includes(Permission.FILESTORAGE_VIEW) ||
			context.requiredPermissions.includes(Permission.FILESTORAGE_REMOVE);

		return isDrawingElement(boardNodeAuthorizable.boardNode) && requiresFileStoragePermission;
	}

	private hasPermissionForDrawingElementFile(userWithBoardRoles: UserWithBoardRoles): boolean {
		// check if user has read permissions with no account for the context.action
		// because everyone should be able to upload files to a drawing element
		return this.isBoardReader(userWithBoardRoles);
	}

	private shouldProcessVideoConferenceElement(boardNodeAuthorizable: BoardNodeAuthorizable): boolean {
		return isVideoConferenceElement(boardNodeAuthorizable.boardNode);
	}

	private hasPermissionForVideoConferenceElement(
		userWithBoardRoles: UserWithBoardRoles,
		context: AuthorizationContext,
		authorizable: BoardNodeAuthorizable
	): boolean {
		if (context.action === Action.write) {
			const canEditorsManageVideoconference = authorizable.boardConfiguration.canEditorsManageVideoconference ?? false;
			return (
				(canEditorsManageVideoconference && this.isBoardEditor(userWithBoardRoles)) ||
				this.isBoardAdmin(userWithBoardRoles)
			);
		}

		return this.isBoardReader(userWithBoardRoles);
	}

	private shouldProcessAssignmentSubmissionFile(
		boardNodeAuthorizable: BoardNodeAuthorizable,
		context: AuthorizationContext
	): boolean {
		const requiresFileStoragePermission =
			context.requiredPermissions.includes(Permission.FILESTORAGE_CREATE) ||
			context.requiredPermissions.includes(Permission.FILESTORAGE_VIEW) ||
			context.requiredPermissions.includes(Permission.FILESTORAGE_REMOVE);

		return isAssignmentSubmission(boardNodeAuthorizable.boardNode) && requiresFileStoragePermission;
	}

	// The submission's file is the one place a plain reader (student) needs write access to
	// a node they do not own the containing board of - mirrors hasPermissionForDrawingElementFile.
	// The owning student may write their file, and only while the assignment is still
	// accepting submissions.
	//
	// Teacher-authored artifacts (audio feedback, annotated corrections) do NOT live here -
	// they attach to a separate AssignmentFeedback child node (see
	// hasPermissionForAssignmentFeedbackFile below). That split is what lets a peer reviewer's
	// read access below stop at the student's own submission file and never reach the
	// teacher's feedback about it - see A1 in the review notes.
	private hasPermissionForAssignmentSubmissionFile(
		userWithBoardRoles: UserWithBoardRoles,
		authorizable: BoardNodeAuthorizable,
		context: AuthorizationContext
	): boolean {
		const submission = authorizable.boardNode as AssignmentSubmission;
		const isOwner = submission.userId === userWithBoardRoles.userId;

		if (context.action === Action.read) {
			// A peer reviewer is neither the owner nor a board editor/admin, but needs to read the
			// file they were assigned to review - see BoardNodeAuthorizableProps.peerReviewerIds.
			const isAssignedReviewer = authorizable.peerReviewerIds?.includes(userWithBoardRoles.userId) ?? false;
			return (
				isOwner || this.isBoardEditor(userWithBoardRoles) || this.isBoardAdmin(userWithBoardRoles) || isAssignedReviewer
			);
		}

		if (!isOwner) {
			return false;
		}

		if (submission.returnedAt) {
			return false;
		}

		const assignment = authorizable.parentNode;
		if (!isAssignmentElement(assignment)) {
			return false;
		}

		return assignment.isSubmittable(new Date());
	}

	private shouldProcessAssignmentFeedbackFile(
		boardNodeAuthorizable: BoardNodeAuthorizable,
		context: AuthorizationContext
	): boolean {
		const requiresFileStoragePermission =
			context.requiredPermissions.includes(Permission.FILESTORAGE_CREATE) ||
			context.requiredPermissions.includes(Permission.FILESTORAGE_VIEW) ||
			context.requiredPermissions.includes(Permission.FILESTORAGE_REMOVE);

		return isAssignmentFeedback(boardNodeAuthorizable.boardNode) && requiresFileStoragePermission;
	}

	// A submission can have several feedback containers: the teacher's own (authorId undefined)
	// and one per assigned peer reviewer (authorId = that reviewer's userId) - see
	// AssignmentFeedback's doc comment. A board editor/admin always has full access, to every
	// container. Below that, access is per-author:
	//
	// write: only the container's own author (a reviewer must still be a currently-eligible
	//   reviewer for this submission - filterCurrentlyEligible's reasoning in PeerReviewUc
	//   applies here too: turning peer review off or removing the assignment must revoke write
	//   access, not just hide the UI for it).
	// read: the container's own author always; the submission's owner once released - the
	//   teacher's container releases with the submission's return (mirrors the metadata release
	//   rule in AssignmentSubmissionResponseMapper.mapForOwner), a reviewer's container releases
	//   once that specific review has been submitted (submittedPeerReviewerIds). Any other
	//   reviewer is never let in - a peer reviewer's own read access stops at the student's
	//   submission file (hasPermissionForAssignmentSubmissionFile) and never reaches another
	//   reviewer's or the teacher's feedback about it - see A1 in the review notes.
	private hasPermissionForAssignmentFeedbackFile(
		userWithBoardRoles: UserWithBoardRoles,
		authorizable: BoardNodeAuthorizable,
		context: AuthorizationContext
	): boolean {
		if (this.isBoardEditor(userWithBoardRoles) || this.isBoardAdmin(userWithBoardRoles)) {
			return true;
		}

		const feedback = authorizable.boardNode;
		if (!isAssignmentFeedback(feedback)) {
			return false;
		}

		const isAuthor = feedback.authorId === userWithBoardRoles.userId;

		if (context.action !== Action.read) {
			// isAuthor is only ever true for a real userId, so this also correctly rejects
			// writes to the teacher's own container (authorId undefined) from anyone but the
			// editor/admin check above
			if (!isAuthor) {
				return false;
			}
			// still assigned to review this submission, and peer review hasn't been turned off
			// since - re-checked here rather than trusted from assignment time, same reasoning
			// as PeerReviewUc.filterCurrentlyEligible
			return authorizable.peerReviewerIds?.includes(userWithBoardRoles.userId) ?? false;
		}

		if (isAuthor) {
			return true;
		}

		const submission = authorizable.parentNode;
		if (!isAssignmentSubmission(submission)) {
			return false;
		}

		const isOwner = submission.userId === userWithBoardRoles.userId;
		if (!isOwner) {
			return false;
		}

		if (feedback.authorId === undefined) {
			return !!submission.returnedAt;
		}

		return authorizable.submittedPeerReviewerIds?.includes(feedback.authorId) ?? false;
	}
}

const hasBoardRole = (user: User, authorizable: BoardNodeAuthorizable, role: BoardRoles): boolean => {
	const userWithBoardRoles = authorizable.users.find((u) => u.userId === user.id);
	return userWithBoardRoles?.roles.includes(role) ?? false;
};

// Whether the caller holds real board-edit permission, independent of the readersCanEdit
// collaboration toggle. Exposed as its own BoardOperation (evaluated against the *board's own*
// authorizable, unlike gradeAssignmentSubmission/updateElement) because the client cannot derive
// this from allowedOperations.updateElement alone: that one is board-wide and already folds a
// reader-with-readersCanEdit into "can edit", which is exactly the case an assignment or poll
// element's client-side manage/teacher view must not treat as "can manage" (see the matching
// carve-outs below and in hasPermission()). A per-element permission check would give the right
// answer too, but would need a separate authorizable per element; this is the same answer without
// the extra loads, since the underlying check (hasEditPermission) never varies by element anyway.
const _isBoardEditor = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);
	return permissions.includes(Permission.BOARD_EDIT);
};

const _canEditBoard = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const isBoard = authorizable.rootNode instanceof ColumnBoard || authorizable.rootNode instanceof MediaBoard;
	if (!isBoard) return false;

	const member = authorizable.users.find(({ userId }) => userId === user.id);
	if (isAiQuestionElement(authorizable.boardNode) && member && isStudentMember(member)) {
		// A school-level student must never edit the teacher's question configuration,
		// even when they have an EDITOR room role rather than the collaboration toggle.
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);
	const hasEditPermission = permissions.includes(Permission.BOARD_EDIT);
	if (hasEditPermission) return true;

	if (isPollElement(authorizable.boardNode) || isPollVote(authorizable.boardNode)) {
		// A poll's questions, status and deadline are configuration with real consequences
		// for participants (e.g. accepting/rejecting votes). The readersCanEdit collaboration
		// toggle must never grant a student write access here, same reasoning as the board
		// title carve-out below. Voting itself is a separate, narrower path (see
		// createOwnPollVote/updateOwnPollVote), unaffected by this carve-out.
		return false;
	}

	const isReader = hasBoardRole(user, authorizable, BoardRoles.READER);
	const readersCanEdit = authorizable.boardConfiguration.canReadersEdit ?? false;

	if (isAssignmentElement(authorizable.boardNode) || isAssignmentSubmission(authorizable.boardNode)) {
		// Assignments carry a due date, a grace period and (once graded) points - configuration
		// and grading with real consequences for a student. The readersCanEdit collaboration
		// toggle must never grant a student write access here, same reasoning as the board
		// title carve-out below. Note this only closes the generic updateElement/deleteElement/
		// moveElement path; a submission's own file has its own, narrower rule (see
		// hasPermissionForAssignmentSubmissionFile), and grading goes through this same function.
		return false;
	}

	if (isAiQuestionElement(authorizable.boardNode)) {
		// An AI question carries the teacher's instructions and the expected answer - the
		// grading reference itself. Letting a reader-with-readersCanEdit write here would
		// both leak the solution (a reader can already see broadcast content, but a writer
		// could also change the question after the fact) and let students reconfigure their
		// own attempt limits. Answering stays a separate, narrower path (see
		// createOwnAiQuestionAnswer/updateOwnAiQuestionAnswer), unaffected by this carve-out.
		return false;
	}

	return isReader && readersCanEdit;
};

const _canManageAiQuestion = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	const member = authorizable.users.find(({ userId }) => userId === user.id);

	return !!member && isTeacherMember(member) && _canEditBoard(user, authorizable);
};

const canEditBoardTitle = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	const isReader = hasBoardRole(user, authorizable, BoardRoles.READER);
	if (isReader) {
		// readers are never allowed to change the board title, even if readersCanEdit is active on the board itself
		return false;
	}

	return _canEditBoard(user, authorizable);
};

const _canManageBoard = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);

	const isBoard = authorizable.rootNode instanceof ColumnBoard || authorizable.rootNode instanceof MediaBoard;
	const canManageBoard = permissions.includes(Permission.BOARD_MANAGE);

	return isBoard && canManageBoard;
};

const _canViewBoard = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);

	const isBoard = authorizable.rootNode instanceof ColumnBoard || authorizable.rootNode instanceof MediaBoard;
	const canViewBoard = permissions.includes(Permission.BOARD_VIEW);

	return isBoard && canViewBoard;
};

const _canCreateExternalToolElement = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const schoolPermissions = [...user.roles].flatMap((role) => role.permissions ?? []);

	const isBoard = authorizable.rootNode instanceof ColumnBoard || authorizable.rootNode instanceof MediaBoard;
	const canCreateExternalToolElement = schoolPermissions.includes(Permission.CONTEXT_TOOL_ADMIN);

	return isBoard && canCreateExternalToolElement;
};

const canFindBoard = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const canViewBoard = _canViewBoard(user, authorizable);
	const permissions = authorizable.getUserPermissions(user.id);

	if (
		authorizable.rootNode instanceof ColumnBoard &&
		!authorizable.rootNode.isVisible &&
		!permissions.includes(Permission.BOARD_EDIT)
	) {
		return false;
	}

	return canViewBoard;
};

const canManageVideoConference = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);

	const isBoard = authorizable.rootNode instanceof ColumnBoard || authorizable.rootNode instanceof MediaBoard;

	const hasPermission = permissions.includes(Permission.BOARD_MANAGE_VIDEOCONFERENCE);

	const isEditor = hasBoardRole(user, authorizable, BoardRoles.EDITOR);
	const canEditorsManageVideoconference = authorizable.boardConfiguration.canEditorsManageVideoconference ?? false;

	const canManageVideoConference = hasPermission || (isEditor && canEditorsManageVideoconference);

	return isBoard && canManageVideoConference;
};

const canUpdateReadersCanEditSetting = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);

	const isBoard = authorizable.boardNode instanceof ColumnBoard;
	const hasManageReadersCanEditPermission = permissions.includes(Permission.BOARD_MANAGE_READERS_CAN_EDIT);

	return isBoard && hasManageReadersCanEditPermission;
};

const canRelocateContent = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);

	const isBoard = authorizable.rootNode instanceof ColumnBoard;
	const hasRelocateContentPermission = permissions.includes(Permission.BOARD_RELOCATE_CONTENT);

	return isBoard && hasRelocateContentPermission;
};

const canShareBoardNode = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const permissions = authorizable.getUserPermissions(user.id);

	const isBoard = authorizable.rootNode instanceof ColumnBoard || authorizable.rootNode instanceof MediaBoard;
	const canShareBoard = permissions.includes(Permission.BOARD_SHARE_BOARD);

	return isBoard && canShareBoard;
};

// Whether this user is eligible to cast a vote in this poll at all, per the poll's own
// audience setting (isEligibleVoter, see poll-audience.ts) - separate from managePoll,
// which stays board-edit-based: a teacher who is also an eligible voter (audience TEACHERS
// or ALL) keeps the ability to open/close/configure the poll regardless of this check.
const _canVoteInPoll = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const { boardNode } = authorizable;
	if (!isPollElement(boardNode)) {
		return false;
	}

	const userWithBoardRoles = authorizable.users.find((u) => u.userId === user.id);
	if (!userWithBoardRoles) {
		return false;
	}

	return isEligibleVoter(boardNode, userWithBoardRoles);
};

// Checks ownership and, via the parent PollElement, continued audience eligibility - a
// change to the poll's audience after a vote was cast must not let that voter go on
// editing a vote they'd no longer be allowed to cast fresh (see U-R4: the audience is
// locked once votes exist, but this is the belt to that suspenders). Deliberately does
// NOT check "now" (whether the poll is still open) - that's PollUc's job, so it can throw
// a specific, clearly-worded exception.
const _isOwnPollVote = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const { boardNode, parentNode } = authorizable;
	if (!isPollVote(boardNode) || boardNode.userId !== user.id) {
		return false;
	}

	if (!parentNode || !isPollElement(parentNode)) {
		return false;
	}

	const userWithBoardRoles = authorizable.users.find((u) => u.userId === user.id);
	if (!userWithBoardRoles) {
		return false;
	}

	return isEligibleVoter(parentNode, userWithBoardRoles);
};

// "student" in a room: has the READER role and none of the roles that imply staff-level
// rights. A room owner/admin can also carry the READER role (e.g. via multiple permission
// grants), so this is deliberately not just "isBoardReader && !isBoardEditor".
const _isPlainBoardReader = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const userWithBoardRoles = authorizable.users.find((u) => u.userId === user.id);
	if (!userWithBoardRoles) {
		return false;
	}

	const isReader = userWithBoardRoles.roles.includes(BoardRoles.READER);
	const isStaff = [BoardRoles.EDITOR, BoardRoles.ADMIN].some((role) => userWithBoardRoles.roles.includes(role));

	return isReader && !isStaff;
};

// Deliberately checks ownership only - business-rule checks that need "now" (deadline,
// already returned) are the assignment use case's job, not the rule's, so they can throw
// specific, clearly-worded exceptions (see AssignmentUc).
const _isOwnAssignmentSubmission = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const { boardNode } = authorizable;
	if (!isAssignmentSubmission(boardNode)) {
		return false;
	}

	return boardNode.userId === user.id;
};

// Deliberately checks ownership only - business-rule checks (whether the element still
// allows multiple attempts) are the AI use case's job, so it can throw specific,
// clearly-worded exceptions. Read access to one's own answer goes through the same check.
const _isOwnAiQuestionAnswer = (user: User, authorizable: BoardNodeAuthorizable): boolean => {
	if (authorizable.boardConfiguration.isLocked) {
		return false;
	}

	const { boardNode } = authorizable;
	if (!isAiQuestionAnswer(boardNode)) {
		return false;
	}

	return boardNode.userId === user.id;
};
