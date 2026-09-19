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
}
