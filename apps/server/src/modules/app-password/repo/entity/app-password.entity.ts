import { Entity, Index, Property } from '@mikro-orm/core';
import { BaseEntityWithTimestamps } from '@shared/domain/entity';
import { EntityId } from '@shared/domain/types';
import { ObjectIdType } from '@shared/repo/types/object-id.type';

export interface AppPasswordProps {
	id: EntityId;
	userId: EntityId;
	name: string;
	secretHash: string;
	lastUsedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

// A user-owned, revocable secret for clients that cannot do the interactive (SSO) login,
// e.g. WebDAV clients like Finder or Windows Explorer. Only the bcrypt hash of the secret
// part is stored; the plain token is shown to the user exactly once on creation.
@Entity({ tableName: 'app-passwords' })
export class AppPasswordEntity extends BaseEntityWithTimestamps implements AppPasswordProps {
	@Index()
	@Property({ type: ObjectIdType, fieldName: 'user', nullable: false })
	userId!: EntityId;

	@Property({ nullable: false })
	name!: string;

	@Property({ nullable: false })
	secretHash!: string;

	@Property({ type: Date, nullable: true })
	lastUsedAt?: Date;
}
