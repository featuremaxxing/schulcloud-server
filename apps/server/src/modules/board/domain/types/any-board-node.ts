import type { AssignmentFeedback } from '../assignment-feedback.do';
import type { AssignmentSubmission } from '../assignment-submission.do';
import type { AiQuestionAnswer } from '../ai-question-answer.do';
import type { Card } from '../card.do';
import type { CollaborativeTextEditorElement } from '../collaborative-text-editor.do';
import type { ColumnBoard } from '../colum-board.do';
import type { Column } from '../column.do';
import type { AnyMediaBoardNode } from '../media-board';
import type { PinnedCard } from '../pinned-card.do';
import type { PollVote } from '../poll-vote.do';
import type { AnyContentElement } from './any-content-element';

export type AnyBoardNode =
	| AnyContentElement
	| AnyMediaBoardNode
	| AiQuestionAnswer
	| AssignmentFeedback
	| AssignmentSubmission
	| Card
	| CollaborativeTextEditorElement
	| Column
	| ColumnBoard
	| PinnedCard
	| PollVote;
