import { Embedded, Entity, Enum, Index, Property } from '@mikro-orm/core';
import { BaseEntityWithTimestamps } from '@shared/domain/entity/base.entity';
import { EntityId, InputFormat } from '@shared/domain/types';
import { ObjectIdType } from '@shared/repo/types/object-id.type';
import {
	AnyBoardNode,
	AssignmentRubricCriterion,
	AssignmentSubmissionCriterionPoints,
	BoardLayout,
	BoardNodeType,
	BoardRoles,
	ContentElementType,
	Colors,
	type PollAnswer,
	PollAudience,
	type PollQuestion,
	type PollResultSnapshot,
	PollStatus,
	ROOT_PATH,
} from '../../domain';
import type { BoardNodeEntityProps } from '../types';
import { Context, PollQuestionEmbeddable, PollResultSnapshotEmbeddable } from './embeddables';

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

	// PollElement
	// --------------------------------------------------------------------------
	@Embedded(() => PollQuestionEmbeddable, { array: true, nullable: true })
	questions: PollQuestion[] | undefined;

	@Property({ type: 'boolean', nullable: true })
	isAnonymous: boolean | undefined;

	@Property({ type: 'boolean', nullable: true })
	showResultsLive: boolean | undefined;

	@Enum({ type: 'PollStatus', nullable: true })
	pollStatus: PollStatus | undefined;

	@Property({ type: 'Date', nullable: true })
	opensAt: Date | undefined;

	@Property({ type: 'Date', nullable: true })
	closesAt: Date | undefined;

	@Embedded(() => PollResultSnapshotEmbeddable, { nullable: true, object: true })
	resultSnapshot: PollResultSnapshot | undefined;

	@Enum({ type: 'PollAudience', nullable: true })
	audience: PollAudience | undefined;

	@Enum({ nullable: true, array: true })
	audienceRoles: BoardRoles[] | undefined;

	@Property({ type: 'boolean', nullable: true })
	allowVoteChange: boolean | undefined;

	// PinnedCard
	// --------------------------------------------------------------------------
	@Index()
	@Property({ type: ObjectIdType, nullable: true })
	referencedCardId: EntityId | undefined;

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

	// the rubric, when the teacher configured one - see AssignmentRubricCriterion
	@Property({ nullable: true })
	criteria: AssignmentRubricCriterion[] | undefined;

	@Property({ type: 'boolean', nullable: true })
	peerReviewEnabled: boolean | undefined;

	@Property({ type: 'string', nullable: true })
	peerReviewMode: 'manual' | 'auto' | undefined;

	@Property({ type: 'integer', nullable: true })
	peerReviewCount: number | undefined;

	// PollVote, AssignmentSubmission
	// --------------------------------------------------------------------------
	@Property({ type: ObjectIdType, nullable: true })
	userId: EntityId | undefined;

	@Property({ type: 'Date', nullable: true })
	votedAt: Date | undefined;

	// Plain nested plain-object array (no @Embedded): MongoDB stores objects/arrays
	// natively, so unlike a relational DB there is no need for a 'json' column type here.
	@Property({ nullable: true })
	answers: PollAnswer[] | undefined;

	@Property({ type: 'Date', nullable: true })
	submittedAt: Date | undefined;

	@Property({ type: 'boolean', nullable: true })
	isLate: boolean | undefined;

	// the submitting student's optional note, sent along with a (re)submit
	@Property({ type: 'string', nullable: true })
	comment: string | undefined;

	@Property({ type: 'integer', nullable: true })
	points: number | undefined;

	@Property({ type: 'string', nullable: true })
	feedbackComment: string | undefined;

	@Property({ type: 'Date', nullable: true })
	returnedAt: Date | undefined;

	@Property({ type: ObjectIdType, nullable: true })
	gradedBy: EntityId | undefined;

	// per-criterion points when the parent element has a rubric - see AssignmentSubmissionCriterionPoints
	@Property({ nullable: true })
	criterionPoints: AssignmentSubmissionCriterionPoints[] | undefined;
}
