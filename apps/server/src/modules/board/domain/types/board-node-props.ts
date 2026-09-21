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
	closesAt?: Date;
	resultSnapshot?: PollResultSnapshot;
	// Who is eligible to vote - defaults to STUDENTS (see PollElement.audience getter) so
	// existing polls keep behaving exactly as before this field existed.
	audience?: PollAudience;
	// Only meaningful when audience is CUSTOM.
	audienceRoles?: BoardRoles[];
}

export interface PollVoteProps extends BoardNodeProps {
	userId: EntityId;
	votedAt?: Date;
	answers: PollAnswer[];
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
	| CardProps
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
