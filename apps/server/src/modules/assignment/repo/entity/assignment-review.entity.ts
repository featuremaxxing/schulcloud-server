import { Entity, Index, Property } from '@mikro-orm/core';
import { ObjectIdType } from '@shared/repo/types/object-id.type';
import { BaseEntityWithTimestamps } from '@shared/domain/entity/base.entity';
import { EntityId } from '@shared/domain/types';

export enum AssignmentReviewAssignmentMode {
	MANUAL = 'manual',
	AUTO = 'auto',
}

export interface AssignmentReviewEntityProps {
	id?: EntityId;
	elementId: EntityId;
	submissionId: EntityId;
	reviewerUserId: EntityId;
	assignmentMode: AssignmentReviewAssignmentMode;
	assignedAt: Date;
	points?: number;
	feedbackComment?: string;
	submittedAt?: Date;
}

// Deliberately not a BoardNode: a review is not part of the board's visual tree, has no
// position/path, and different anonymization/lifecycle rules than board content - modeling it
// as one would mean touching the BoardNode type union, factory and repo mapper for a construct
// that needs none of that machinery. See AssignmentUc/PeerReviewUc for authorization, done by
// hand here (room-membership + submission ownership) rather than via BoardNodeRule.
@Entity({ tableName: 'assignmentreviews' })
export class AssignmentReviewEntity extends BaseEntityWithTimestamps {
	@Property({ type: ObjectIdType })
	@Index()
	elementId: EntityId;

	@Property({ type: ObjectIdType })
	@Index()
	submissionId: EntityId;

	@Property({ type: ObjectIdType })
	@Index()
	reviewerUserId: EntityId;

	@Property({ type: 'string' })
	assignmentMode: AssignmentReviewAssignmentMode;

	@Property({ type: 'Date' })
	assignedAt: Date;

	@Property({ type: 'integer', nullable: true })
	points?: number;

	@Property({ type: 'string', nullable: true })
	feedbackComment?: string;

	@Property({ type: 'Date', nullable: true })
	submittedAt?: Date;

	constructor(props: AssignmentReviewEntityProps) {
		super();
		if (props.id !== undefined) {
			this.id = props.id;
		}
		this.elementId = props.elementId;
		this.submissionId = props.submissionId;
		this.reviewerUserId = props.reviewerUserId;
		this.assignmentMode = props.assignmentMode;
		this.assignedAt = props.assignedAt;
		this.points = props.points;
		this.feedbackComment = props.feedbackComment;
		this.submittedAt = props.submittedAt;
	}
}
