import { Embedded, Entity, Enum, Index, Property } from '@mikro-orm/core';
import { BaseEntityWithTimestamps } from '@shared/domain/entity/base.entity';
import { EntityId, InputFormat } from '@shared/domain/types';
import { ObjectIdType } from '@shared/repo/types/object-id.type';
import { AnyBoardNode, BoardLayout, BoardNodeType, ContentElementType, Colors, ROOT_PATH } from '../../domain';
import type { BoardNodeEntityProps } from '../types';
import { Context } from './embeddables';

@Entity({ tableName: 'boardnodes' })
export class BoardNodeEntity extends BaseEntityWithTimestamps implements BoardNodeEntityProps {
	// Generic Tree
	// --------------------------------------------------------------------------
	@Index()
	@Property({ nullable: false })
	path = ROOT_PATH;

	@Property({ nullable: false, type: 'integer' })
	level = 0;

	@Property({ nullable: false, type: 'integer' })
	position = 0;

	@Index()
	@Enum(() => BoardNodeType)
	type!: BoardNodeType;

	@Property({ persist: false })
	children: AnyBoardNode[] = [];

	@Property({ persist: false })
	domainObject: AnyBoardNode | undefined;

	// Card, Column, ColumnBoard, LinkElement, MedialLine, DeletedElement
	// --------------------------------------------------------------------------
	@Property({ nullable: true })
	title: string | undefined;

	// LinkElement, DrawingElement
	@Property({ type: 'string', nullable: true })
	description: string | undefined;

	// ColumnBoard, MediaBoard
	// --------------------------------------------------------------------------
	@Embedded(() => Context, { prefix: false, nullable: true })
	context: BoardNodeEntityProps['context'] | undefined;

	@Enum({ type: 'BoardLayout', nullable: true })
	layout: BoardLayout | undefined;

	// ColumnBoard
	// --------------------------------------------------------------------------
	@Property({ type: 'boolean', nullable: true })
	isVisible: boolean | undefined;

	@Property({ type: 'boolean', nullable: true })
	readersCanEdit: boolean | undefined;

	// Card
	// --------------------------------------------------------------------------
	@Property({ type: 'integer', nullable: true })
	height: number | undefined;

	// RichTextElement
	// --------------------------------------------------------------------------
	@Property({ type: 'string', nullable: true })
	text: string | undefined;

	@Enum({ type: 'InputFormat', nullable: true })
	inputFormat: InputFormat | undefined;

	// LinkElement
	// --------------------------------------------------------------------------
	@Property({ type: 'string', nullable: true })
	url: string | undefined;

	@Property({ type: 'string', nullable: true })
	imageUrl: string | undefined;

	@Property({ type: 'string', nullable: true })
	originalImageUrl: string | undefined;

	// FileElement
	// --------------------------------------------------------------------------
	@Property({ type: 'string', nullable: true })
	caption: string | undefined;

	@Property({ type: 'string', nullable: true })
	alternativeText: string | undefined;

	// ExternalToolElement, MediaExternalToolElement
	// --------------------------------------------------------------------------
	@Property({ type: ObjectIdType, fieldName: 'contextExternalTool', nullable: true })
	contextExternalToolId: EntityId | undefined;

	// H5PElement
	// --------------------------------------------------------------------------
	@Property({ type: ObjectIdType, nullable: true })
	contentId: EntityId | undefined;

	// MediaLine, MediaBoard
	// --------------------------------------------------------------------------
	@Property({ type: 'boolean', nullable: true })
	collapsed: boolean | undefined;

	// MediaLine, MediaBoard, Card
	// --------------------------------------------------------------------------
	@Enum({ type: 'Colors', nullable: true })
	backgroundColor: Colors | undefined;

	// DeletedElement
	// --------------------------------------------------------------------------
	@Enum({ type: 'ContentElementType', nullable: true })
	deletedElementType: ContentElementType | undefined;

	// AssignmentElement
	// --------------------------------------------------------------------------
	@Property({ type: 'Date', nullable: true })
	startDate: Date | undefined;

	@Property({ type: 'Date', nullable: true })
	dueDate: Date | undefined;

	@Property({ type: 'integer', nullable: true })
	graceMinutes: number | undefined;

	@Property({ type: 'integer', nullable: true })
	maxPoints: number | undefined;

	// AssignmentSubmission
	// --------------------------------------------------------------------------
	@Property({ type: ObjectIdType, nullable: true })
	userId: EntityId | undefined;

	@Property({ type: 'Date', nullable: true })
	submittedAt: Date | undefined;

	@Property({ type: 'boolean', nullable: true })
	isLate: boolean | undefined;

	@Property({ type: 'integer', nullable: true })
	points: number | undefined;

	@Property({ type: 'string', nullable: true })
	feedbackComment: string | undefined;

	@Property({ type: 'Date', nullable: true })
	returnedAt: Date | undefined;

	@Property({ type: ObjectIdType, nullable: true })
	gradedBy: EntityId | undefined;
}
