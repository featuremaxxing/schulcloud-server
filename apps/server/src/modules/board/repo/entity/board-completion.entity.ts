import { Entity, Index, Property, Unique } from '@mikro-orm/core';
import { BaseEntityWithTimestamps } from '@shared/domain/entity/base.entity';
import { EntityId } from '@shared/domain/types';
import { ObjectIdType } from '@shared/repo/types/object-id.type';

export type BoardCompletionSource = 'manual' | 'progress';

export interface BoardCompletionEntityProps {
	id?: EntityId;
	userId: EntityId;
	boardId: EntityId;
	completedAt: Date;
	source: BoardCompletionSource;
}

// A person has completed a board of a learning path: either marked by hand (boards without
// progress items) or recorded once the progress reached 100 %. Kept so a completed step stays
// completed when the teacher adds items later. Not a BoardNode, it is personal data.
@Entity({ tableName: 'board-completions' })
@Unique({ properties: ['userId', 'boardId'] })
export class BoardCompletionEntity extends BaseEntityWithTimestamps {
	@Property({ type: ObjectIdType })
	@Index()
	userId: EntityId;

	@Property({ type: ObjectIdType })
	@Index()
	boardId: EntityId;

	@Property({ type: 'Date' })
	completedAt: Date;

	@Property({ type: 'string' })
	source: BoardCompletionSource;

	constructor(props: BoardCompletionEntityProps) {
		super();
		if (props.id) this.id = props.id;
		this.userId = props.userId;
		this.boardId = props.boardId;
		this.completedAt = props.completedAt;
		this.source = props.source;
	}
}
