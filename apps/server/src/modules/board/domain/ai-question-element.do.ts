import { BoardNode } from './board-node.do';
import { isAiQuestionAnswer } from './ai-question-answer.do';
import type { AnyBoardNode, AiQuestionElementProps } from './types';

// An AI question is a card element the teacher configures: the question itself,
// optional instructions for the AI (what to consider, how to phrase the answer) and
// an optional expected answer used as the grading reference. Students answer once
// (or repeatedly, when allowMultipleAttempts is set) and the AI responds with a
// single assessment - there is no chat.
export class AiQuestionElement extends BoardNode<AiQuestionElementProps> {
	get question(): string {
		return this.props.question;
	}

	set question(value: string) {
		this.props.question = value;
	}

	get creatorId(): string | undefined {
		return this.props.creatorId;
	}

	set creatorId(value: string | undefined) {
		this.props.creatorId = value;
	}

	get onlyCreatorCanEdit(): boolean {
		return this.props.onlyCreatorCanEdit ?? false;
	}

	set onlyCreatorCanEdit(value: boolean) {
		this.props.onlyCreatorCanEdit = value;
	}

	// Teacher-authored guidance for the AI, never broadcast to students - it is served
	// exclusively through the editor-only config endpoint (see AiQuestionUc.getConfig).
	get aiInstructions(): string | undefined {
		return this.props.aiInstructions;
	}

	set aiInstructions(value: string | undefined) {
		this.props.aiInstructions = value;
	}

	// The grading reference for the AI, same visibility rules as aiInstructions.
	get expectedAnswer(): string | undefined {
		return this.props.expectedAnswer;
	}

	set expectedAnswer(value: string | undefined) {
		this.props.expectedAnswer = value;
	}

	// Whether a student may replace their answer after submitting it. Defaults to
	// false ("einmalig") - see AiQuestionElementProps.
	get allowMultipleAttempts(): boolean {
		return this.props.allowMultipleAttempts ?? false;
	}

	set allowMultipleAttempts(value: boolean) {
		this.props.allowMultipleAttempts = value;
	}

	public canHaveChild(childNode: AnyBoardNode): boolean {
		return isAiQuestionAnswer(childNode);
	}
}

export const isAiQuestionElement = (reference: unknown): reference is AiQuestionElement =>
	reference instanceof AiQuestionElement;
