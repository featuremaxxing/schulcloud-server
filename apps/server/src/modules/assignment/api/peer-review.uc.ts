import { FileDto, FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import { Logger } from '@infra/logger';
import {
	AssignmentElement,
	AssignmentReviewAssignmentMode,
	AssignmentReviewEntity,
	AssignmentReviewRepo,
	AssignmentSubmission,
	BOARD_PUBLIC_API_CONFIG_TOKEN,
	BoardNodeAuthorizable,
	BoardNodeAuthorizableService,
	BoardNodeRule,
	BoardNodeService,
	BoardPublicApiConfig,
} from '@modules/board';
import { AuthorizationService } from '@modules/authorization';
import {
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { AssignmentFilesStorageErrorLoggable } from './loggable/assignment-files-storage-error.loggable';

export interface PeerReviewSettingsBody {
	enabled: boolean;
	mode?: 'manual' | 'auto';
	count?: number;
}

export interface PeerReviewAssignmentPair {
	submissionId: EntityId;
	reviewerUserId: EntityId;
}

export interface PeerReviewSubmitBody {
	points?: number;
	feedbackComment?: string;
}

export interface PeerReviewTaskResult {
	review: AssignmentReviewEntity;
	file?: FileDto;
}

// Effectively "everyone reviews everyone" for a very large class - not a real assignment
// scenario, just a sane upper bound so a stray large value cannot make autoAssign fan out
// n*count review rows for an element with many submissions.
const MAX_PEER_REVIEW_COUNT = 20;

@Injectable()
export class PeerReviewUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly assignmentReviewRepo: AssignmentReviewRepo,
		private readonly filesStorageClientAdapterService: FilesStorageClientAdapterService,
		private readonly logger: Logger,
		@Inject(BOARD_PUBLIC_API_CONFIG_TOKEN) private readonly boardConfig: BoardPublicApiConfig
	) {}

	public async updateSettings(
		userId: EntityId,
		elementId: EntityId,
		body: PeerReviewSettingsBody
	): Promise<AssignmentElement> {
		this.checkFeatureEnabled();

		const { element } = await this.loadElementForTeacher(userId, elementId);

		element.peerReviewEnabled = body.enabled;
		if (body.mode !== undefined) {
			element.peerReviewMode = body.mode;
		}
		if (body.count !== undefined) {
			// autoAssign clamps this again against the actual submission count at assignment time
			// (there may be fewer than count+1 submissions yet), but a negative or absurdly high
			// value has no valid meaning here regardless of submission count.
			element.peerReviewCount = Math.max(1, Math.min(body.count, MAX_PEER_REVIEW_COUNT));
		}
		await this.boardNodeService.save(element);

		return element;
	}

	// Cycle-free rotation: reviewer at index i reviews submission at index (i + offset) % n for
	// offset in 1..min(count, n-1) - an offset of 0 (or a multiple of n) would assign someone
	// their own submission, so count is capped at n-1 (one reviewer short of "everyone reviews
	// everyone"). Deliberately deterministic rather than randomized, see plan notes; re-running
	// this replaces every previous assignment for the element, manual or auto.
	public async autoAssign(userId: EntityId, elementId: EntityId): Promise<{ assignedCount: number }> {
		this.checkFeatureEnabled();

		const { element } = await this.loadElementForTeacher(userId, elementId);
		const submissions = element.getChildrenOfType(AssignmentSubmission).filter((s) => s.id);

		if (submissions.length < 2) {
			throw new ConflictException('At least two submissions are required to auto-assign peer reviews.');
		}

		const effectiveCount = Math.min(element.peerReviewCount, submissions.length - 1);
		const now = new Date();
		const reviews: AssignmentReviewEntity[] = [];

		for (let offset = 1; offset <= effectiveCount; offset += 1) {
			for (let i = 0; i < submissions.length; i += 1) {
				const reviewer = submissions[i];
				const target = submissions[(i + offset) % submissions.length];

				// Guaranteed unreachable by the offset bound above (effectiveCount <= submissions.length
				// - 1) as long as every submission belongs to a distinct student - kept as an explicit
				// check anyway so the invariant doesn't rely on that assumption holding elsewhere.
				if (reviewer.userId === target.userId) {
					continue;
				}

				reviews.push(
					new AssignmentReviewEntity({
						elementId,
						submissionId: target.id,
						reviewerUserId: reviewer.userId,
						assignmentMode: AssignmentReviewAssignmentMode.AUTO,
						assignedAt: now,
					})
				);
			}
		}

		await this.assignmentReviewRepo.deleteByElementId(elementId);
		await this.assignmentReviewRepo.saveAll(reviews);

		return { assignedCount: reviews.length };
	}

	public async manualAssign(
		userId: EntityId,
		elementId: EntityId,
		assignments: PeerReviewAssignmentPair[]
	): Promise<{ assignedCount: number }> {
		this.checkFeatureEnabled();

		const { element, boardNodeAuthorizable } = await this.loadElementForTeacher(userId, elementId);
		const submissions = element.getChildrenOfType(AssignmentSubmission);
		const memberIds = new Set(boardNodeAuthorizable.users.map((user) => user.userId));
		const now = new Date();

		const reviews = assignments.map((pair) => {
			const submission = submissions.find((s) => s.id === pair.submissionId);
			if (!submission) {
				throw new UnprocessableEntityException(`Unknown submission id ${pair.submissionId}.`);
			}
			if (!memberIds.has(pair.reviewerUserId)) {
				throw new UnprocessableEntityException(`${pair.reviewerUserId} is not a member of this room.`);
			}
			if (pair.reviewerUserId === submission.userId) {
				throw new UnprocessableEntityException('A student cannot be assigned to review their own submission.');
			}

			return new AssignmentReviewEntity({
				elementId,
				submissionId: pair.submissionId,
				reviewerUserId: pair.reviewerUserId,
				assignmentMode: AssignmentReviewAssignmentMode.MANUAL,
				assignedAt: now,
			});
		});

		// Delete-then-insert on exactly this batch's pairings, not the whole element (that would
		// also wipe out unrelated manual assignments and any already-submitted review feedback) -
		// makes re-submitting the same assignment (e.g. a double click) idempotent instead of
		// creating duplicate rows. The unique index on the entity is the backstop for anything this
		// misses.
		await this.assignmentReviewRepo.deleteByPairs(
			elementId,
			assignments.map((pair) => {
				return { submissionId: pair.submissionId, reviewerUserId: pair.reviewerUserId };
			})
		);
		await this.assignmentReviewRepo.saveAll(reviews);

		return { assignedCount: reviews.length };
	}

	// Anonymized by construction: only the file to review is fetched, never the submission's
	// owner (no name/userId lookup happens here at all).
	public async listMyTasks(userId: EntityId): Promise<PeerReviewTaskResult[]> {
		this.checkFeatureEnabled();

		const reviews = await this.assignmentReviewRepo.findByReviewerUserId(userId);

		return Promise.all(
			reviews.map(async (review): Promise<PeerReviewTaskResult> => {
				try {
					const files = await this.filesStorageClientAdapterService.listFilesOfParent(review.submissionId);
					const file = pickLatestNonFeedbackFile(files);
					return { review, file };
				} catch (error) {
					this.logger.warning(new AssignmentFilesStorageErrorLoggable(review.submissionId, error as Error));
					return { review };
				}
			})
		);
	}

	public async submitReview(
		userId: EntityId,
		reviewId: EntityId,
		body: PeerReviewSubmitBody
	): Promise<AssignmentReviewEntity> {
		this.checkFeatureEnabled();

		const review = await this.assignmentReviewRepo.findById(reviewId);
		if (!review) {
			throw new NotFoundException('Peer review task not found.');
		}
		if (review.reviewerUserId !== userId) {
			throw new ForbiddenException('This peer review task is not assigned to you.');
		}

		review.points = body.points;
		review.feedbackComment = body.feedbackComment;
		review.submittedAt = new Date();
		await this.assignmentReviewRepo.save(review);

		return review;
	}

	private async loadElementForTeacher(
		userId: EntityId,
		elementId: EntityId
	): Promise<{ element: AssignmentElement; boardNodeAuthorizable: BoardNodeAuthorizable }> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AssignmentElement, elementId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('gradeAssignmentSubmission', user, boardNodeAuthorizable));

		return { element, boardNodeAuthorizable };
	}

	private checkFeatureEnabled(): void {
		if (!this.boardConfig.featureColumnBoardAssignmentEnabled) {
			throw new ForbiddenException('Assignments are not enabled.');
		}
	}
}

const FEEDBACK_PREFIX = 'feedback-';

const pickLatestNonFeedbackFile = (files: FileDto[]): FileDto | undefined => {
	const candidates = files.filter((file) => !file.name.startsWith(FEEDBACK_PREFIX));
	if (candidates.length === 0) {
		return undefined;
	}

	return [...candidates].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
};
