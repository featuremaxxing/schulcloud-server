import type { AssignmentFeedback } from '../assignment-feedback.do';
import type { AssignmentSubmission } from '../assignment-submission.do';
import type { Card } from '../card.do';
import type { CollaborativeTextEditorElement } from '../collaborative-text-editor.do';
import type { ColumnBoard } from '../colum-board.do';
import type { Column } from '../column.do';
import type { AnyMediaBoardNode } from '../media-board';
import type { AnyContentElement } from './any-content-element';

export type AnyBoardNode =
	| AnyContentElement
	| AnyMediaBoardNode
	| AssignmentFeedback
	| AssignmentSubmission
	| Card
	| CollaborativeTextEditorElement
	| Column
	| ColumnBoard;
