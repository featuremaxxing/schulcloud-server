import { NotImplementedException } from '@nestjs/common';
import { AiQuestionAnswer } from './ai-question-answer.do';
import { AiQuestionElement } from './ai-question-element.do';
import { AssignmentElement } from './assignment-element.do';
import { AssignmentFeedback } from './assignment-feedback.do';
import { AssignmentSubmission } from './assignment-submission.do';
import { Card } from './card.do';
import { CollaborativeTextEditorElement } from './collaborative-text-editor.do';
import { ColumnBoard } from './colum-board.do';
import { Column } from './column.do';
import { DeletedElement } from './deleted-element.do';
import { DrawingElement } from './drawing-element.do';
import { ExternalToolElement } from './external-tool-element.do';
import { FileElement } from './file-element.do';
import { FileFolderElement } from './file-folder-element.do';
import { H5pElement } from './h5p-element.do';
import { LinkElement } from './link-element.do';
import { MediaBoard, MediaExternalToolElement, MediaLine } from './media-board';
import { PinnedCard } from './pinned-card.do';
import { PollElement } from './poll-element.do';
import { PollVote } from './poll-vote.do';
import { RichTextElement } from './rich-text-element.do';
import { type AnyBoardNode, BoardNodeType } from './types';
import { VideoConferenceElement } from './video-conference-element.do';

// register node types
const BoardNodeTypeToConstructor = {
	[BoardNodeType.AI_QUESTION_ANSWER]: AiQuestionAnswer,
	[BoardNodeType.AI_QUESTION_ELEMENT]: AiQuestionElement,
	[BoardNodeType.ASSIGNMENT_ELEMENT]: AssignmentElement,
	[BoardNodeType.ASSIGNMENT_FEEDBACK]: AssignmentFeedback,
	[BoardNodeType.ASSIGNMENT_SUBMISSION]: AssignmentSubmission,
	[BoardNodeType.CARD]: Card,
	[BoardNodeType.PINNED_CARD]: PinnedCard,
	[BoardNodeType.COLLABORATIVE_TEXT_EDITOR]: CollaborativeTextEditorElement,
	[BoardNodeType.COLUMN]: Column,
	[BoardNodeType.COLUMN_BOARD]: ColumnBoard,
	[BoardNodeType.DRAWING_ELEMENT]: DrawingElement,
	[BoardNodeType.EXTERNAL_TOOL]: ExternalToolElement,
	[BoardNodeType.FILE_ELEMENT]: FileElement,
	[BoardNodeType.FILE_FOLDER_ELEMENT]: FileFolderElement,
	[BoardNodeType.LINK_ELEMENT]: LinkElement,
	[BoardNodeType.MEDIA_BOARD]: MediaBoard,
	[BoardNodeType.MEDIA_EXTERNAL_TOOL_ELEMENT]: MediaExternalToolElement,
	[BoardNodeType.MEDIA_LINE]: MediaLine,
	[BoardNodeType.RICH_TEXT_ELEMENT]: RichTextElement,
	[BoardNodeType.VIDEO_CONFERENCE_ELEMENT]: VideoConferenceElement,
	[BoardNodeType.DELETED_ELEMENT]: DeletedElement,
	[BoardNodeType.H5P_ELEMENT]: H5pElement,
	[BoardNodeType.POLL_ELEMENT]: PollElement,
	[BoardNodeType.POLL_VOTE]: PollVote,
} as const;

export const getBoardNodeConstructor = <T extends BoardNodeType>(type: T): (typeof BoardNodeTypeToConstructor)[T] =>
	BoardNodeTypeToConstructor[type];

export const getBoardNodeType = <T extends AnyBoardNode>(boardNode: T): BoardNodeType => {
	const type = Object.keys(BoardNodeTypeToConstructor).find((key) => {
		const Constructor = BoardNodeTypeToConstructor[key as BoardNodeType];
		return boardNode instanceof Constructor;
	});
	if (type === undefined) {
		throw new Error(`Cannot get type of board node class '${boardNode.constructor.name}'`);
	}
	return type as BoardNodeType;
};

export const handleNonExhaustiveSwitch = (type: never): never => {
	throw new NotImplementedException(`unknown board node type '${JSON.stringify(type)}'`);
};
