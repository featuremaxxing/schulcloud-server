import { FileDto, FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import { Logger } from '@infra/logger';
import {
	AssignmentElement,
	AssignmentFeedback,
	AssignmentReviewEntity,
	AssignmentReviewRepo,
	AssignmentRubricCriterion,
	AssignmentStatus,
	AssignmentSubmission,
	AssignmentSubmissionCriterionPoints,
	BOARD_PUBLIC_API_CONFIG_TOKEN,
	BoardNodeAuthorizableService,
	BoardNodeFactory,
	BoardNodeRule,
	BoardNodeService,
	BoardPublicApiConfig,
	isAssignmentElement,
	isAssignmentFeedback,
	isStudentMember,
} from '@modules/board';
import { AuthorizationService } from '@modules/authorization';
import { RoleName } from '@modules/role';
import { RoomAuthorizable, RoomMembershipService } from '@modules/room-membership';
import { RoomContentService } from '@modules/room';
import {
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { Permission } from '@shared/domain/interface';
import { EntityId } from '@shared/domain/types';
import { AssignmentBatchReturnErrorLoggable } from './loggable/assignment-batch-return-error.loggable';
import { AssignmentFilesStorageErrorLoggable } from './loggable/assignment-files-storage-error.loggable';

export interface PeerReviewSummary {
	averagePoints: number | null;
	count: number;
	comments: string[];
}

// One reviewer's feedback on a submission - the identified counterpart to PeerReviewSummary
// above (which stays anonymous/averaged). Teacher view: full data, one entry per assignment,
// submitted or not. Owner view (mapForOwner): only entries with submittedAt set, and with the
// reviewer's identity stripped - see AssignmentSubmissionResponseMapper.
export interface PeerReviewFeedbackEntry {
	reviewerUserId: EntityId;
	reviewerFirstName?: string;
	reviewerLastName?: string;
	points?: number;
	feedbackComment?: string;
	submittedAt?: Date;
	files?: FileDto[];
}

export interface GradeBody {
	points?: number;
	feedbackComment?: string;
	criterionPoints?: AssignmentSubmissionCriterionPoints[];
}

export interface AssignmentSubmissionEntry {
	userId: EntityId;
	firstName?: string;
	lastName?: string;
	submission?: AssignmentSubmission;
	file?: FileDto;
	feedbackAudio?: FileDto;
	// all teacher feedback files (annotated corrections etc.), newest first - the
	// mapper withholds them from students until the submission has been returned
	feedbackFiles?: FileDto[];
	// every file the student has ever uploaded as their submission document, newest
	// first (including the current one) - never gated, this is the student's own work
	fileVersions?: FileDto[];
	// advisory student peer reviews, teacher view only - see AssignmentUc.buildPeerReviewSummary
	peerReviews?: PeerReviewSummary;
	// identified peer review feedback (files, comment, points) - see PeerReviewFeedbackEntry
	peerReviewFeedback?: PeerReviewFeedbackEntry[];
	// which teacher graded this submission - relevant once a room has more than one
	// teacher; teacher view only, never sent to the submission's owner (see
	// AssignmentSubmissionResponseMapper.mapForOwner)
	gradedBy?: { userId: EntityId; firstName?: string; lastName?: string };
}

export interface AssignmentSubmissionsListResult {
	element: AssignmentElement;
	isTeacher: boolean;
	entries: AssignmentSubmissionEntry[];
}

export interface AssignmentSubmissionResult {
	submission: AssignmentSubmission;
	file?: FileDto;
	feedbackAudio?: FileDto;
	feedbackFiles?: FileDto[];
	fileVersions?: FileDto[];
}

export interface AssignmentListEntry {
	element: AssignmentElement;
	roomId: EntityId;
	boardId: EntityId;
	cardId: EntityId;
	isTeacher: boolean;
	// teacher: all submissions below the element; student: only the caller's own
	submissions: AssignmentSubmission[];
}

@Injectable()
export class AssignmentUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly filesStorageClientAdapterService: FilesStorageClientAdapterService,
		private readonly roomMembershipService: RoomMembershipService,
		private readonly roomContentService: RoomContentService,
		private readonly assignmentReviewRepo: AssignmentReviewRepo,
		private readonly logger: Logger,
		@Inject(BOARD_PUBLIC_API_CONFIG_TOKEN) private readonly boardConfig: BoardPublicApiConfig
	) {}

	// Overview for the assignments list page and the room dashboard: every assignment
	// element in the caller's rooms, with submission counts (teacher) or the caller's
	// own submission status (student). Authorisation is room-based (see isRoomEditor) -
	// a user can only ever be a reader or editor of rooms they are a member of, and
	// elements cannot exist outside a room board, so no per-element check is needed.
	public async listAssignments(userId: EntityId, roomId?: EntityId): Promise<AssignmentListEntry[]> {
		this.checkFeatureEnabled();

		const rooms = await this.roomMembershipService.getRoomAuthorizablesByUserId(userId);
		const relevantRooms = roomId ? rooms.filter((room) => room.roomId === roomId) : rooms;

		// A caller who is neither a room editor (isTeacher below) nor a school-level student
		// (e.g. a colleague added as a room viewer) must not be shown the student view either -
		// they'd see a submission prompt for an assignment the server would then reject a
		// submission for.
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const isStudentSchoolRole = user.getRoles().some((role) => role.name === RoleName.STUDENT);

		const entries: AssignmentListEntry[] = [];
		for (const room of relevantRooms) {
			// only boards the room actually references (its "Lerninhalt") - the database can
			// contain older, unlinked boards whose assignments must not surface here
			const boardIds = await this.roomContentService.getBoardOrder(room.roomId);
			if (boardIds.length === 0) {
				continue;
			}

			const isTeacher = this.isRoomEditor(room, userId);
			if (!isTeacher && !isStudentSchoolRole) {
				continue;
			}

			const elements = await this.boardNodeService.findAssignmentElementsByBoardIds(boardIds, {
				// draft boards (isVisible=false) are unreachable for students - offering a
				// deep link would 404 the board page for them
				onlyVisible: !isTeacher,
			});
			if (elements.length === 0) {
				continue;
			}

			const now = new Date();
			for (const element of elements) {
				// assignments that have not started yet are invisible for students -
				// consistent with how the board element hides itself before the startDate
				if (!isTeacher && !element.isStartedAt(now)) {
					continue;
				}

				entries.push({
					element,
					roomId: room.roomId,
					boardId: this.pathSegmentOf(element, 0),
					cardId: this.pathSegmentOf(element, 2),
					isTeacher,
					submissions: [],
				});
			}
		}

		const elementIds = entries.map((entry) => entry.element.id);
		const submissions = await this.boardNodeService.findAssignmentSubmissionsByParentIds(elementIds);
		for (const submission of submissions) {
			const entry = entries.find((candidate) => submission.path.endsWith(`,${candidate.element.id},`));
			if (!entry) {
				continue;
			}
			if (entry.isTeacher || submission.userId === userId) {
				entry.submissions.push(submission);
			}
		}

		return entries;
	}

	// The element's path is ',<boardId>,<columnId>,<cardId>,<elementId>' - the board
	// and card ids are what the client needs to deep-link to the element's card.
	private pathSegmentOf(element: AssignmentElement, index: number): EntityId {
		return element.path.split(',').filter(Boolean)[index];
	}

	public async listSubmissions(userId: EntityId, elementId: EntityId): Promise<AssignmentSubmissionsListResult> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		// depth 2, not 1: submissions are level 1 below the element, and their AssignmentFeedback
		// child (if any) is level 2 - getSubmissionFiles below needs that child already loaded to
		// find the teacher's feedback files.
		const element = await this.boardNodeService.findByClassAndId(AssignmentElement, elementId, 2);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('viewAssignmentSubmissions', user, boardNodeAuthorizable));

		// gradeAssignmentSubmission is a strict "is this user a real board editor" check
		// (readersCanEdit is explicitly excluded for assignment nodes, see board-node.rule.ts) -
		// reusing it here avoids duplicating that decision.
		const isTeacher = this.boardNodeRule.can('gradeAssignmentSubmission', user, boardNodeAuthorizable);
		const submissions = element.getChildrenOfType(AssignmentSubmission);

		if (isTeacher) {
			const students = boardNodeAuthorizable.users.filter(isStudentMember);
			const allReviews = await this.assignmentReviewRepo.findByElementId(element.id);

			const entries = await Promise.all(
				students.map(async (student): Promise<AssignmentSubmissionEntry> => {
					const submission = submissions.find((s) => s.userId === student.userId);
					const files = submission ? await this.getSubmissionFiles(submission) : {};
					const gradedByUser = submission?.gradedBy
						? boardNodeAuthorizable.users.find((candidate) => candidate.userId === submission.gradedBy)
						: undefined;

					return {
						userId: student.userId,
						firstName: student.firstName,
						lastName: student.lastName,
						submission,
						file: files.submissionFile,
						feedbackAudio: files.feedbackAudio,
						feedbackFiles: files.feedbackFiles,
						fileVersions: files.fileVersions,
						peerReviews: submission ? this.buildPeerReviewSummary(allReviews, submission.id) : undefined,
						peerReviewFeedback: submission
							? await this.buildPeerReviewFeedback(allReviews, submission, boardNodeAuthorizable.users)
							: undefined,
						gradedBy: submission?.gradedBy
							? {
									userId: submission.gradedBy,
									firstName: gradedByUser?.firstName,
									lastName: gradedByUser?.lastName,
								}
							: undefined,
					};
				})
			);

			return { element, isTeacher: true, entries };
		}

		const ownSubmission = submissions.find((s) => s.userId === userId);
		const ownFiles = ownSubmission ? await this.getSubmissionFiles(ownSubmission) : {};
		// the owner is never a board editor here, so no reviewer names to resolve - mapForOwner
		// strips identity anyway (see PeerReviewFeedbackEntry)
		const ownReviews = ownSubmission ? await this.assignmentReviewRepo.findBySubmissionId(ownSubmission.id) : [];
		const ownPeerReviewFeedback = ownSubmission
			? await this.buildPeerReviewFeedback(ownReviews, ownSubmission, [])
			: undefined;

		return {
			element,
			isTeacher: false,
			entries: [
				{
					userId,
					submission: ownSubmission,
					file: ownFiles.submissionFile,
					feedbackAudio: ownFiles.feedbackAudio,
					feedbackFiles: ownFiles.feedbackFiles,
					fileVersions: ownFiles.fileVersions,
					peerReviewFeedback: ownPeerReviewFeedback,
				},
			],
		};
	}

	public async createOwnSubmission(userId: EntityId, elementId: EntityId): Promise<AssignmentSubmissionResult> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AssignmentElement, elementId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('createOwnAssignmentSubmission', user, boardNodeAuthorizable));

		const existing = element.getChildrenOfType(AssignmentSubmission).find((s) => s.userId === userId);
		if (existing) {
			// idempotent: repeated "start submission" clicks must not create duplicates
			return { submission: existing };
		}

		this.assertSubmittable(element, new Date());

		const submission = this.boardNodeFactory.buildAssignmentSubmission(userId);
		await this.boardNodeService.addToParent(element, submission);

		return { submission };
	}

	public async submit(userId: EntityId, submissionId: EntityId, comment?: string): Promise<AssignmentSubmissionResult> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const submission = await this.boardNodeService.findByClassAndId(AssignmentSubmission, submissionId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(submission);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnAssignmentSubmission', user, boardNodeAuthorizable));

		const element = this.getParentAssignmentElement(boardNodeAuthorizable.parentNode);

		if (submission.returnedAt) {
			throw new ForbiddenException('This submission has already been graded and returned.');
		}

		const now = new Date();
		this.assertSubmittable(element, now);

		let submissionFiles: FileDto[];
		try {
			submissionFiles = await this.filesStorageClientAdapterService.listFilesOfParent(submission.id);
		} catch (error) {
			// the file storage RPC fails as a plain 500 upstream - surface a deliberate,
			// dedicated error instead of an unlabelled internal server error
			this.logger.warning(new AssignmentFilesStorageErrorLoggable(submission.id, error as Error));
			throw new InternalServerErrorException(
				'The file of this submission could not be verified. Please try again later.'
			);
		}

		if (pickLatestFile(submissionFiles) === undefined) {
			throw new ConflictException('Please upload a file before submitting.');
		}

		submission.submittedAt = now;
		submission.isLate = element.isLateAt(now);
		if (comment !== undefined) {
			submission.comment = comment;
		}
		await this.boardNodeService.save(submission);

		// submission was loaded via findByClassAndId without a depth limit, so its
		// AssignmentFeedback child (if it already has one) is loaded too.
		const feedback = await this.getFeedbackFiles(submission);

		return {
			submission,
			file: pickLatestFile(submissionFiles),
			...feedback,
			fileVersions: pickSubmissionFileVersions(submissionFiles),
		};
	}

	public async deleteOwnSubmission(userId: EntityId, submissionId: EntityId): Promise<void> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const submission = await this.boardNodeService.findByClassAndId(AssignmentSubmission, submissionId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(submission);

		throwForbiddenIfFalse(this.boardNodeRule.can('deleteOwnAssignmentSubmission', user, boardNodeAuthorizable));

		if (submission.returnedAt) {
			throw new ForbiddenException('This submission has already been graded and returned.');
		}

		// Withdrawing is a write to the submission just like (re)submitting - it must stop being
		// possible once the deadline has passed, same as replacing the file
		// (hasPermissionForAssignmentSubmissionFile already enforces this for the file itself; this
		// closes the matching gap for the submission node/withdrawal path).
		const element = this.getParentAssignmentElement(boardNodeAuthorizable.parentNode);
		this.assertSubmittable(element, new Date());

		// deleting the board node triggers BoardNodeDeleteHooksService, which removes the
		// attached file via afterDeleteAssignmentSubmission
		await this.boardNodeService.delete(submission);
	}

	public async gradeSubmission(
		userId: EntityId,
		submissionId: EntityId,
		body: GradeBody
	): Promise<AssignmentSubmissionResult> {
		this.checkFeatureEnabled();

		const { submission, element } = await this.loadOwnedSubmissionForGrading(userId, submissionId);

		// Only touch points when the caller actually sent some - a save that only carries a
		// comment must not silently wipe out an already-saved grade (see returnSubmission below,
		// which already got this right).
		if (body.points !== undefined || body.criterionPoints !== undefined) {
			this.applyPoints(element, submission, body);
		}
		submission.feedbackComment = normalizeFeedbackComment(body.feedbackComment);
		submission.gradedBy = userId;
		await this.boardNodeService.save(submission);

		const files = await this.getSubmissionFiles(submission);

		return {
			submission,
			file: files.submissionFile,
			feedbackAudio: files.feedbackAudio,
			feedbackFiles: files.feedbackFiles,
			fileVersions: files.fileVersions,
		};
	}

	public async returnSubmission(
		userId: EntityId,
		submissionId: EntityId,
		body: GradeBody
	): Promise<AssignmentSubmissionResult> {
		this.checkFeatureEnabled();

		const { submission, element } = await this.loadOwnedSubmissionForGrading(userId, submissionId);

		if (body.points !== undefined || body.criterionPoints !== undefined) {
			this.applyPoints(element, submission, body);
		}
		this.applyReturn(submission, userId, body);
		await this.boardNodeService.save(submission);

		const files = await this.getSubmissionFiles(submission);

		return {
			submission,
			file: files.submissionFile,
			feedbackAudio: files.feedbackAudio,
			feedbackFiles: files.feedbackFiles,
			fileVersions: files.fileVersions,
		};
	}

	// Returns everyone who is already graded (status IN_REVIEW) in one step, without changing
	// their points/feedbackComment - those must already have been saved via gradeSubmission.
	// Best-effort: a submission that cannot be returned (not graded yet, not owned by the
	// caller, unknown id) is reported in `failed` instead of aborting the whole batch, so the
	// teacher still gets everyone else returned from a single "return all graded" click.
	//
	// Deliberately does NOT call getSubmissionFiles per submission here: that is a File-Storage
	// AMQP round-trip per item, run strictly sequentially in this loop, and the only caller (the
	// client's batch-return button) discards the returned submissions' file data and reloads the
	// whole list afterwards anyway - see AssignmentSubmissionsOverlay.vue onBatchReturn.
	public async returnSubmissionsBatch(
		userId: EntityId,
		submissionIds: EntityId[]
	): Promise<{ returned: AssignmentSubmissionResult[]; failed: { submissionId: EntityId; reason: string }[] }> {
		this.checkFeatureEnabled();

		const returned: AssignmentSubmissionResult[] = [];
		const failed: { submissionId: EntityId; reason: string }[] = [];

		for (const submissionId of submissionIds) {
			try {
				const { submission } = await this.loadOwnedSubmissionForGrading(userId, submissionId);

				if (submission.getStatus() !== AssignmentStatus.IN_REVIEW) {
					failed.push({ submissionId, reason: 'This submission has not been graded yet.' });
					continue;
				}

				this.applyReturn(submission, userId, {});
				await this.boardNodeService.save(submission);

				returned.push({ submission });
			} catch (error) {
				failed.push({ submissionId, reason: this.toBatchFailureReason(submissionId, error) });
			}
		}

		return { returned, failed };
	}

	// Maps to one of the two failure reasons a caller can actually act on; anything else (a
	// forbidden/not-found/internal error's raw message) must not leak past the API boundary, so
	// it is logged instead and reported as a generic reason.
	private toBatchFailureReason(submissionId: EntityId, error: unknown): string {
		if (error instanceof ForbiddenException) {
			return 'This submission cannot be returned by you.';
		}
		if (error instanceof NotFoundException) {
			return 'This submission could not be found.';
		}

		this.logger.warning(
			new AssignmentBatchReturnErrorLoggable(submissionId, error instanceof Error ? error : new Error(String(error)))
		);

		return 'This submission could not be returned.';
	}

	// Shared by returnSubmission and returnSubmissionsBatch. The batch path calls this with an
	// empty body since it only returns already-graded submissions as-is; the single-submission
	// path may still carry a last-minute feedbackComment change alongside the return. Points
	// (flat or per-criterion) are handled separately by applyPoints, called before this when
	// the body actually carries a points update.
	private applyReturn(submission: AssignmentSubmission, gradedBy: EntityId, body: { feedbackComment?: string }): void {
		const feedbackComment = normalizeFeedbackComment(body.feedbackComment);
		if (feedbackComment !== undefined) {
			submission.feedbackComment = feedbackComment;
		}
		submission.gradedBy = gradedBy;
		submission.returnedAt = new Date();
	}

	// Writes points to the submission, either as a single flat value or - when the element has
	// a rubric - as the validated sum of per-criterion points (criterionPoints is then also
	// persisted, so a later edit can be pre-filled). A rubric assignment requires
	// criterionPoints in the body; there is no flat-points fallback once criteria exist.
	private applyPoints(element: AssignmentElement, submission: AssignmentSubmission, body: GradeBody): void {
		if (element.criteria && element.criteria.length > 0) {
			if (body.criterionPoints === undefined) {
				throw new UnprocessableEntityException('criterionPoints is required for assignments with a rubric.');
			}
			this.validateCriterionPoints(element.criteria, body.criterionPoints);
			submission.criterionPoints = body.criterionPoints;
			submission.points = body.criterionPoints.reduce((sum, criterion) => sum + criterion.points, 0);
			return;
		}

		this.validatePoints(element, body.points);
		submission.points = body.points;
	}

	private async loadOwnedSubmissionForGrading(
		userId: EntityId,
		submissionId: EntityId
	): Promise<{ submission: AssignmentSubmission; element: AssignmentElement }> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const submission = await this.boardNodeService.findByClassAndId(AssignmentSubmission, submissionId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(submission);

		throwForbiddenIfFalse(this.boardNodeRule.can('gradeAssignmentSubmission', user, boardNodeAuthorizable));

		const element = this.getParentAssignmentElement(boardNodeAuthorizable.parentNode);

		return { submission, element };
	}

	private getParentAssignmentElement(parentNode: unknown): AssignmentElement {
		if (!isAssignmentElement(parentNode)) {
			throw new NotFoundException('Assignment element not found for this submission.');
		}

		return parentNode;
	}

	private validatePoints(element: AssignmentElement, points: number | undefined): void {
		if (points === undefined) {
			return;
		}

		if (points < 0 || (element.maxPoints !== undefined && points > element.maxPoints)) {
			throw new UnprocessableEntityException(
				`points must be between 0 and ${element.maxPoints ?? 'the assignment default'}.`
			);
		}
	}

	// Every criterion must be scored, exactly once, within its own bounds - a partial or
	// unknown-criterion submission would silently under/over-count the derived total.
	private validateCriterionPoints(
		criteria: AssignmentRubricCriterion[],
		criterionPoints: AssignmentSubmissionCriterionPoints[]
	): void {
		if (criterionPoints.length !== criteria.length) {
			throw new UnprocessableEntityException('criterionPoints must contain exactly one entry per rubric criterion.');
		}

		for (const entry of criterionPoints) {
			const criterion = criteria.find((c) => c.id === entry.criterionId);
			if (!criterion) {
				throw new UnprocessableEntityException(`Unknown rubric criterion id ${entry.criterionId}.`);
			}
			if (entry.points < 0 || entry.points > criterion.maxPoints) {
				throw new UnprocessableEntityException(
					`points for criterion ${criterion.name} must be between 0 and ${criterion.maxPoints}.`
				);
			}
		}
	}

	// submission must already have its children loaded (either via an unbounded-depth
	// findByClassAndId, or an explicit depth that reaches one level below it) so its
	// AssignmentFeedback child, if any, can be found without an extra board-node fetch.
	private async getSubmissionFiles(submission: AssignmentSubmission): Promise<{
		submissionFile?: FileDto;
		feedbackAudio?: FileDto;
		feedbackFiles?: FileDto[];
		fileVersions?: FileDto[];
	}> {
		const submissionFiles = await this.listFilesSafely(submission.id);
		const feedback = await this.getFeedbackFiles(submission);

		return {
			submissionFile: pickLatestFile(submissionFiles),
			fileVersions: pickSubmissionFileVersions(submissionFiles),
			...feedback,
		};
	}

	// Split out from getSubmissionFiles so submit() - which lists the submission's own files
	// itself, with different (throwing) error handling - can still reuse the feedback half.
	// Only ever the teacher's own container (authorId undefined) - a submission can also carry
	// one container per peer reviewer now (see AssignmentFeedback's doc comment), but those are
	// surfaced separately, through PeerReviewUc/AssignmentSubmissionEntry.peerReviewFeedback.
	private async getFeedbackFiles(
		submission: AssignmentSubmission
	): Promise<{ feedbackAudio?: FileDto; feedbackFiles?: FileDto[] }> {
		const feedback = findTeacherFeedbackContainer(submission);
		if (!feedback) {
			return {};
		}

		const files = await this.listFilesSafely(feedback.id);

		return {
			feedbackAudio: pickLatestFeedbackAudio(files),
			feedbackFiles: pickFeedbackFiles(files),
		};
	}

	private async listFilesSafely(parentId: EntityId): Promise<FileDto[]> {
		try {
			return await this.filesStorageClientAdapterService.listFilesOfParent(parentId);
		} catch (error) {
			// A broken file record (e.g. from an interrupted upload) must not take down the
			// whole submission view - the file storage RPC errors would surface as a 500
			// here. Log it and present the submission without its file instead.
			this.logger.warning(new AssignmentFilesStorageErrorLoggable(parentId, error as Error));

			return [];
		}
	}

	// Idempotent: returns the existing AssignmentFeedback child if the caller (a teacher)
	// already attached feedback before, otherwise creates one. Created lazily - a submission
	// with no teacher feedback yet never gets this node at all, keeping listSubmissions'
	// per-student file lookups to one RPC instead of two for the common case.
	public async ensureFeedbackContainer(userId: EntityId, submissionId: EntityId): Promise<AssignmentFeedback> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const submission = await this.boardNodeService.findByClassAndId(AssignmentSubmission, submissionId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(submission);

		throwForbiddenIfFalse(this.boardNodeRule.can('gradeAssignmentSubmission', user, boardNodeAuthorizable));

		const existing = findTeacherFeedbackContainer(submission);
		if (existing) {
			return existing;
		}

		const feedback = this.boardNodeFactory.buildAssignmentFeedback();
		await this.boardNodeService.addToParent(submission, feedback);

		return feedback;
	}

	// Advisory only - averages submitted reviews for one submission, never touches
	// points/criterionPoints. Reviewer identity is intentionally left out of the summary.
	private buildPeerReviewSummary(
		allReviews: AssignmentReviewEntity[],
		submissionId: EntityId
	): PeerReviewSummary | undefined {
		const reviews = allReviews.filter((review) => review.submissionId === submissionId && review.submittedAt);
		if (reviews.length === 0) {
			return undefined;
		}

		const withPoints = reviews.filter((review) => review.points !== undefined);
		const averagePoints =
			withPoints.length > 0
				? withPoints.reduce((sum, review) => sum + (review.points ?? 0), 0) / withPoints.length
				: null;

		return {
			averagePoints,
			count: reviews.length,
			comments: reviews.map((review) => review.feedbackComment).filter((comment): comment is string => !!comment),
		};
	}

	// Identified counterpart to buildPeerReviewSummary above - every review for this submission
	// (submitted or not), with the reviewer's own correction files if they've started one. Only
	// one extra file-storage RPC per review that actually has a container (most don't, until the
	// reviewer opens the annotator) - see ensureReviewFeedbackContainer.
	private buildPeerReviewFeedback(
		allReviews: AssignmentReviewEntity[],
		submission: AssignmentSubmission,
		users: readonly { userId: EntityId; firstName?: string; lastName?: string }[]
	): Promise<PeerReviewFeedbackEntry[]> {
		const reviews = allReviews.filter((review) => review.submissionId === submission.id);

		return Promise.all(
			reviews.map(async (review): Promise<PeerReviewFeedbackEntry> => {
				const reviewer = users.find((candidate) => candidate.userId === review.reviewerUserId);
				const container = submission.children.find(
					(child): child is AssignmentFeedback =>
						isAssignmentFeedback(child) && child.authorId === review.reviewerUserId
				);
				const files = container ? await this.listFilesSafely(container.id) : undefined;

				return {
					reviewerUserId: review.reviewerUserId,
					reviewerFirstName: reviewer?.firstName,
					reviewerLastName: reviewer?.lastName,
					points: review.points,
					feedbackComment: review.feedbackComment,
					submittedAt: review.submittedAt,
					files,
				};
			})
		);
	}

	private checkFeatureEnabled(): void {
		if (!this.boardConfig.featureColumnBoardAssignmentEnabled) {
			throw new ForbiddenException('Assignments are not enabled.');
		}
	}

	private assertSubmittable(element: AssignmentElement, now: Date): void {
		if (!element.isStartedAt(now)) {
			throw new ForbiddenException('This assignment has not started yet.');
		}

		if (!element.isSubmittable(now)) {
			throw new ForbiddenException('This assignment is not accepting submissions anymore.');
		}
	}

	// Teacher/student split for the assignment list, derived from the caller's room role.
	// This mirrors how board roles are derived from room roles (ROOM_EDIT_CONTENT ->
	// editor -> BOARD_EDIT), so it matches what boardNodeRule would decide per element.
	private isRoomEditor(room: RoomAuthorizable, userId: EntityId): boolean {
		const role = room.getRoleOfUser(userId);
		return !!role?.permissions?.includes(Permission.ROOM_EDIT_CONTENT);
	}
}

// A submission node and its AssignmentFeedback child (see assignment-feedback.do.ts) are
// separate file storage parents now, so "is this the student's file or the teacher's" is
// answered by which node a file lists under - never by its name. Within the feedback
// node's own files, the audio recording is still told apart from the annotated
// corrections (PDF/image) by the name prefix the client sets (`feedback-audio-` vs
// `feedback-pdf-`/`feedback-img-`), since the file storage RPC does not expose mime
// types. If more than one file of a kind exists (e.g. a race between two uploads), the
// most recently created one wins for the singular fields.
const FEEDBACK_AUDIO_PREFIX = 'feedback-audio-';

const isFeedbackAudio = (file: FileDto): boolean => file.name.startsWith(FEEDBACK_AUDIO_PREFIX);

// The teacher's own feedback container has authorId undefined - a submission can also carry one
// container per peer reviewer (authorId = that reviewer's userId), but those are never what this
// use case's teacher-feedback fields (feedbackAudio/feedbackFiles/feedbackContainerId) mean.
const findTeacherFeedbackContainer = (submission: AssignmentSubmission): AssignmentFeedback | undefined =>
	submission.children.find(
		(child): child is AssignmentFeedback => isAssignmentFeedback(child) && child.authorId === undefined
	);

const pickLatestFile = (files: FileDto[]): FileDto | undefined => {
	if (files.length === 0) {
		return undefined;
	}

	const sorted = [...files].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

	return sorted[0];
};

// GradeBody types feedbackComment as string | undefined, but that is only a compile-time
// promise: class-validator's @IsOptional() lets a literal `null` in the JSON body straight
// through untouched. AssignmentSubmission.getStatus() reads `feedbackComment !== undefined` to
// decide a submission is graded, and `null !== undefined` - so an unnormalized null would mark
// an otherwise-untouched submission as graded, making it eligible for a batch return it was
// never actually given a comment or points for.
const normalizeFeedbackComment = (feedbackComment: string | null | undefined): string | undefined =>
	feedbackComment ?? undefined;

const pickLatestFeedbackAudio = (files: FileDto[]): FileDto | undefined =>
	pickLatestFile(files.filter(isFeedbackAudio));

const pickFeedbackFiles = (files: FileDto[]): FileDto[] => {
	const sorted = [...files].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

	return sorted;
};

// Every submission document version the student has ever uploaded (including the current
// one), newest first. Nothing is ever deleted on resubmission, and the submission node no
// longer holds anything else - the mapper turns this into 1-based version numbers, oldest = v1.
const pickSubmissionFileVersions = (files: FileDto[]): FileDto[] => {
	const sorted = [...files].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

	return sorted;
};
