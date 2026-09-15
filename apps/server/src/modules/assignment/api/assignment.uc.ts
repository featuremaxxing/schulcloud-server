import { FileDto, FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import {
	AssignmentElement,
	AssignmentSubmission,
	BOARD_PUBLIC_API_CONFIG_TOKEN,
	BoardNodeAuthorizableService,
	BoardNodeFactory,
	BoardNodeRule,
	BoardNodeService,
	BoardPublicApiConfig,
	BoardRoles,
	isAssignmentElement,
} from '@modules/board';
import { AuthorizationService } from '@modules/authorization';
import { RoomAuthorizable, RoomMembershipService } from '@modules/room-membership';
import {
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { Permission } from '@shared/domain/interface';
import { EntityId } from '@shared/domain/types';

export interface AssignmentSubmissionEntry {
	userId: EntityId;
	firstName?: string;
	lastName?: string;
	submission?: AssignmentSubmission;
	file?: FileDto;
}

export interface AssignmentSubmissionsListResult {
	element: AssignmentElement;
	isTeacher: boolean;
	entries: AssignmentSubmissionEntry[];
}

export interface AssignmentSubmissionResult {
	submission: AssignmentSubmission;
	file?: FileDto;
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

		const entries: AssignmentListEntry[] = [];
		for (const room of relevantRooms) {
			const elements = await this.boardNodeService.findAssignmentElementsByRoomIds([room.roomId]);
			if (elements.length === 0) {
				continue;
			}

			const isTeacher = this.isRoomEditor(room, userId);
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
		const element = await this.boardNodeService.findByClassAndId(AssignmentElement, elementId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('viewAssignmentSubmissions', user, boardNodeAuthorizable));

		// gradeAssignmentSubmission is a strict "is this user a real board editor" check
		// (readersCanEdit is explicitly excluded for assignment nodes, see board-node.rule.ts) -
		// reusing it here avoids duplicating that decision.
		const isTeacher = this.boardNodeRule.can('gradeAssignmentSubmission', user, boardNodeAuthorizable);
		const submissions = element.getChildrenOfType(AssignmentSubmission);

		if (isTeacher) {
			const students = boardNodeAuthorizable.users.filter(isPlainStudent);

			const entries = await Promise.all(
				students.map(async (student): Promise<AssignmentSubmissionEntry> => {
					const submission = submissions.find((s) => s.userId === student.userId);
					const file = submission ? await this.getLatestFile(submission.id) : undefined;

					return {
						userId: student.userId,
						firstName: student.firstName,
						lastName: student.lastName,
						submission,
						file,
					};
				})
			);

			return { element, isTeacher: true, entries };
		}

		const ownSubmission = submissions.find((s) => s.userId === userId);
		const ownFile = ownSubmission ? await this.getLatestFile(ownSubmission.id) : undefined;

		return { element, isTeacher: false, entries: [{ userId, submission: ownSubmission, file: ownFile }] };
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

	public async submit(userId: EntityId, submissionId: EntityId): Promise<AssignmentSubmissionResult> {
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

		const files = await this.filesStorageClientAdapterService.listFilesOfParent(submission.id);
		if (files.length === 0) {
			throw new ConflictException('Please upload a file before submitting.');
		}

		submission.submittedAt = now;
		submission.isLate = element.isLateAt(now);
		await this.boardNodeService.save(submission);

		return { submission, file: pickLatestFile(files) };
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

		// deleting the board node triggers BoardNodeDeleteHooksService, which removes the
		// attached file via afterDeleteAssignmentSubmission
		await this.boardNodeService.delete(submission);
	}

	public async gradeSubmission(
		userId: EntityId,
		submissionId: EntityId,
		body: { points?: number; feedbackComment?: string }
	): Promise<AssignmentSubmissionResult> {
		this.checkFeatureEnabled();

		const { submission, element } = await this.loadOwnedSubmissionForGrading(userId, submissionId);

		this.validatePoints(element, body.points);

		submission.points = body.points;
		submission.feedbackComment = body.feedbackComment;
		submission.gradedBy = userId;
		await this.boardNodeService.save(submission);

		const file = await this.getLatestFile(submission.id);

		return { submission, file };
	}

	public async returnSubmission(
		userId: EntityId,
		submissionId: EntityId,
		body: { points?: number; feedbackComment?: string }
	): Promise<AssignmentSubmissionResult> {
		this.checkFeatureEnabled();

		const { submission, element } = await this.loadOwnedSubmissionForGrading(userId, submissionId);

		this.validatePoints(element, body.points);

		if (body.points !== undefined) {
			submission.points = body.points;
		}
		if (body.feedbackComment !== undefined) {
			submission.feedbackComment = body.feedbackComment;
		}
		submission.gradedBy = userId;
		submission.returnedAt = new Date();
		await this.boardNodeService.save(submission);

		const file = await this.getLatestFile(submission.id);

		return { submission, file };
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

	private async getLatestFile(parentId: EntityId): Promise<FileDto | undefined> {
		const files = await this.filesStorageClientAdapterService.listFilesOfParent(parentId);

		return pickLatestFile(files);
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

const isPlainStudent = (student: { userId: EntityId; roles: BoardRoles[] }): boolean => {
	const isReader = student.roles.includes(BoardRoles.READER);
	const isStaff = [BoardRoles.EDITOR, BoardRoles.ADMIN].some((role) => student.roles.includes(role));

	return isReader && !isStaff;
};

// V1 keeps at most one file per submission; if more than one somehow exists (e.g. a race
// between two uploads), the most recently created one wins.
const pickLatestFile = (files: FileDto[]): FileDto | undefined => {
	if (files.length === 0) {
		return undefined;
	}

	const sorted = [...files].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

	return sorted[0];
};
