import type { EntityId, InputFormat } from '@shared/domain/types';
import type { Colors } from '../media-board';
import type { AnyBoardNode } from './any-board-node';
import type { BoardExternalReference } from './board-external-reference';
import type { BoardLayout } from './board-layout.enum';
import type { ContentElementType } from './content-element-type.enum';
import type { BoardRoles } from '../board-node-authorizable.do';
import type { PollAnswer, PollAudience, PollQuestion, PollResultSnapshot, PollStatus } from './poll.types';

export interface BoardNodeProps {
	id: EntityId;
	path: string;
	level: number;
	position: number;
	children: AnyBoardNode[];
	createdAt: Date;
	updatedAt: Date;
}

export interface ColumnBoardProps extends BoardNodeProps {
	title: string;
	context: BoardExternalReference;
	isVisible: boolean;
	layout: BoardLayout;
	readersCanEdit: boolean;
}

export interface ColumnProps extends BoardNodeProps {
	title?: string;
}

export interface CardProps extends BoardNodeProps {
	title?: string;
	backgroundColor?: Colors;
	height: number;
}

export interface PinnedCardProps extends BoardNodeProps {
	referencedCardId: EntityId;
}

export type CollaborativeTextEditorElementProps = BoardNodeProps;

export interface DrawingElementProps extends BoardNodeProps {
	description: string;
}

export interface ExternalToolElementProps extends BoardNodeProps {
	contextExternalToolId?: string;
}

export interface FileElementProps extends BoardNodeProps {
	alternativeText?: string;
	caption?: string;
}
export interface LinkElementProps extends BoardNodeProps {
	title: string;
	url: string;
	description?: string;
	originalImageUrl?: string;
	imageUrl?: string;
}

export interface RichTextElementProps extends BoardNodeProps {
	text: string;
	inputFormat: InputFormat;
}

export interface VideoConferenceElementProps extends BoardNodeProps {
	title: string;
}

export interface FileFolderElementProps extends BoardNodeProps {
	title: string;
}

export interface DeletedElementProps extends BoardNodeProps {
	title: string;
	deletedElementType: ContentElementType;
	description?: string;
}

export interface H5pElementProps extends BoardNodeProps {
	contentId?: string;
}

export interface PollElementProps extends BoardNodeProps {
	title?: string;
	questions: PollQuestion[];
	isAnonymous: boolean;
	showResultsLive: boolean;
	pollStatus: PollStatus;
	// When the poll starts accepting votes - undefined means "no gate, open immediately once
	// pollStatus is OPEN" (see PollElement.isOpen), matching how closesAt already behaves.
	opensAt?: Date;
	closesAt?: Date;
	resultSnapshot?: PollResultSnapshot;
	// Who is eligible to vote - defaults to STUDENTS (see PollElement.audience getter) so
	// existing polls keep behaving exactly as before this field existed.
	audience?: PollAudience;
	// Only meaningful when audience is CUSTOM.
	audienceRoles?: BoardRoles[];
	// Whether a voter may revise an already-submitted answer to an already-answered question.
	// Defaults to false (see PollElement.allowVoteChange getter) - a question the voter hasn't
	// answered yet (skipped, or added after they voted) stays answerable either way, this only
	// locks answers that already exist. See poll-answer.ts mergePollAnswers.
	allowVoteChange?: boolean;
}

export interface PollVoteProps extends BoardNodeProps {
	userId: EntityId;
	votedAt?: Date;
	answers: PollAnswer[];
}

export interface AssignmentRubricCriterion {
	id: string;
	name: string;
	maxPoints: number;
}

export interface AssignmentElementProps extends BoardNodeProps {
	title: string;
	text: string;
	inputFormat: InputFormat;
	startDate?: Date;
	dueDate?: Date;
	graceMinutes?: number;
	maxPoints?: number;
	// when set (non-empty), grading uses one point value per criterion instead of the single
	// flat maxPoints/points fields - see AssignmentUc.gradeSubmission
	criteria?: AssignmentRubricCriterion[];
	// peer review settings - reviews themselves live in the separate AssignmentReviewEntity
	// (not a BoardNode), see PeerReviewUc
	peerReviewEnabled?: boolean;
	peerReviewMode?: 'manual' | 'auto';
	peerReviewCount?: number;
}

export interface AssignmentSubmissionCriterionPoints {
	criterionId: string;
	points: number;
}

export interface AssignmentSubmissionProps extends BoardNodeProps {
	userId: EntityId;
	submittedAt?: Date;
	isLate?: boolean;
	points?: number;
	feedbackComment?: string;
	returnedAt?: Date;
	gradedBy?: EntityId;
	comment?: string;
	// only set when the parent element has rubric criteria; `points` is still the derived,
	// authoritative total, written alongside this by the use case
	criterionPoints?: AssignmentSubmissionCriterionPoints[];
}

export interface AssignmentFeedbackProps extends BoardNodeProps {
	// undefined = the teacher's own feedback container; set = a specific reviewer's own
	// correction container. Reuses the same entity column AssignmentSubmissionProps.userId
	// already maps onto (see BoardNodeEntity.userId) rather than adding a new one - the two
	// node types are never confused because their BoardNodeType differs. See AssignmentFeedback's
	// doc comment for why containers are split by author at all.
	userId?: EntityId;
}

export interface MediaBoardProps extends BoardNodeProps {
	context: BoardExternalReference;
	backgroundColor: Colors;
	collapsed: boolean;
	layout: BoardLayout;
}

// TODO use only one interface for media-external-tool and external-tool
export interface MediaExternalToolElementProps extends BoardNodeProps {
	contextExternalToolId: string;
}

export interface MediaLineProps extends BoardNodeProps {
	backgroundColor: Colors;
	collapsed: boolean;
	title: string;
}

type MediaBoardNodeProps = MediaBoardProps | MediaExternalToolElementProps | MediaLineProps;

export type AnyBoardNodeProps =
	| AssignmentElementProps
	| AssignmentFeedbackProps
	| AssignmentSubmissionProps
	| CardProps
	| PinnedCardProps
	| CollaborativeTextEditorElementProps
	| ColumnBoardProps
	| ColumnProps
	| DrawingElementProps
	| ExternalToolElementProps
	| FileElementProps
	| FileFolderElementProps
	| LinkElementProps
	| RichTextElementProps
	| VideoConferenceElementProps
	| DeletedElementProps
	| H5pElementProps
	| PollElementProps
	| PollVoteProps
	| MediaBoardNodeProps;
