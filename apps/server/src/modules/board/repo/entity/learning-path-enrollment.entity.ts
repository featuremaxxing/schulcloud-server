import { Entity, Index, Property, Unique } from '@mikro-orm/core';
import { BaseEntityWithTimestamps } from '@shared/domain/entity/base.entity';
import { EntityId } from '@shared/domain/types';
import { ObjectIdType } from '@shared/repo/types/object-id.type';

export interface LearningPathEnrollmentEntityProps {
	id?: EntityId;
	userId: EntityId;
	pathBoardId: EntityId;
	roomId: EntityId;
}

// A person goes a learning path of a room. Only the learning paths a person is enrolled in lock
// boards for them. Not a BoardNode, it is personal data.
@Entity({ tableName: 'learning-path-enrollments' })
@Unique({ properties: ['userId', 'pathBoardId'] })
export class LearningPathEnrollmentEntity extends BaseEntityWithTimestamps {
	@Property({ type: ObjectIdType })
	@Index()
	userId: EntityId;

	@Property({ type: ObjectIdType })
	@Index()
	pathBoardId: EntityId;

	@Property({ type: ObjectIdType })
	@Index()
	roomId: EntityId;

	constructor(props: LearningPathEnrollmentEntityProps) {
		super();
		if (props.id) this.id = props.id;
		this.userId = props.userId;
		this.pathBoardId = props.pathBoardId;
		this.roomId = props.roomId;
	}
}
