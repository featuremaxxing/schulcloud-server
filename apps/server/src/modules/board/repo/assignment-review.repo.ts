import { EntityManager } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { AssignmentReviewEntity } from './entity';

@Injectable()
export class AssignmentReviewRepo {
	constructor(private readonly em: EntityManager) {}

	public async findByElementId(elementId: EntityId): Promise<AssignmentReviewEntity[]> {
		return await this.em.find(AssignmentReviewEntity, { elementId });
	}

	public async findByReviewerUserId(reviewerUserId: EntityId): Promise<AssignmentReviewEntity[]> {
		return await this.em.find(AssignmentReviewEntity, { reviewerUserId });
	}

	// Used by BoardNodeAuthorizableService to grant the assigned reviewer(s) read access to the
	// submission's file - see BoardNodeAuthorizableProps.peerReviewerIds.
	public async findBySubmissionId(submissionId: EntityId): Promise<AssignmentReviewEntity[]> {
		return await this.em.find(AssignmentReviewEntity, { submissionId });
	}

	public async findById(id: EntityId): Promise<AssignmentReviewEntity | null> {
		return await this.em.findOne(AssignmentReviewEntity, { id });
	}

	public async save(review: AssignmentReviewEntity): Promise<void> {
		this.em.persist(review);
		await this.em.flush();
	}

	public async saveAll(reviews: AssignmentReviewEntity[]): Promise<void> {
		this.em.persist(reviews);
		await this.em.flush();
	}

	public async deleteByElementId(elementId: EntityId): Promise<void> {
		await this.em.nativeDelete(AssignmentReviewEntity, { elementId });
	}

	// Deletes exactly the given (submissionId, reviewerUserId) pairings for one element - used by
	// PeerReviewUc.manualAssign so re-running an assignment (e.g. a double click) replaces the
	// matching rows instead of duplicating them, without touching pairings outside this batch.
	public async deleteByPairs(
		elementId: EntityId,
		pairs: { submissionId: EntityId; reviewerUserId: EntityId }[]
	): Promise<void> {
		if (pairs.length === 0) {
			return;
		}

		await this.em.nativeDelete(AssignmentReviewEntity, {
			elementId,
			$or: pairs.map((pair) => {
				return { submissionId: pair.submissionId, reviewerUserId: pair.reviewerUserId };
			}),
		});
	}
}
