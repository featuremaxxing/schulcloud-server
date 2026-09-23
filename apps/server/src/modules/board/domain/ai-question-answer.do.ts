import { type EntityId } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import type { AnyBoardNode, AiQuestionAnswerProps } from './types';

// An answer is never a content element itself (it cannot be added via the
// "add element" dialog) but a regular node in the board tree, one per student,
// living below its AiQuestionElement. Only the latest attempt is kept - a
// re-answer overwrites answer/aiResponse and bumps attemptCount. The answer text
// is personal data; it is only ever served to its owner and to board editors
// (see AiQuestionUc).
//
// TODO(Löschkonzept): answers are personal data and must be deleted automatically
// 4 weeks after the end of the school year in which the parent element was created,
// like assignment submissions (see assignment-submission.do.ts).
export class AiQuestionAnswer extends BoardNode<AiQuestionAnswerProps> {
	get userId(): EntityId {
		return this.props.userId;
	}

	set userId(value: EntityId) {
		this.props.userId = value;
	}

	get answer(): string | undefined {
		return this.props.answer;
	}

	set answer(value: string | undefined) {
		this.props.answer = value;
	}

	// The AI's single assessment of `answer`. Undefined only while unanswering is
	// impossible in practice: the use case persists answer and aiResponse together,
	// after the AI call succeeded.
	get aiResponse(): string | undefined {
		return this.props.aiResponse;
	}

	set aiResponse(value: string | undefined) {
		this.props.aiResponse = value;
	}

	get points(): number | undefined {
		return this.props.points;
	}

	set points(value: number | undefined) {
		this.props.points = value;
	}

	get maxPoints(): number | undefined {
		return this.props.maxPoints;
	}

	set maxPoints(value: number | undefined) {
		this.props.maxPoints = value;
	}

	get aiFlagged(): boolean {
		return this.props.aiFlagged ?? false;
	}

	set aiFlagged(value: boolean) {
		this.props.aiFlagged = value;
	}

	get aiFlagReason(): string | undefined {
		return this.props.aiFlagReason;
	}

	set aiFlagReason(value: string | undefined) {
		this.props.aiFlagReason = value;
	}

	get studentFlagged(): boolean {
		return this.props.studentFlagged ?? false;
	}

	set studentFlagged(value: boolean) {
		this.props.studentFlagged = value;
	}

	get answeredAt(): Date | undefined {
		return this.props.answeredAt;
	}

	set answeredAt(value: Date | undefined) {
		this.props.answeredAt = value;
	}

	// How many times this student has answered (1 on first submit, incremented on
	// every re-answer when the element allows multiple attempts).
	get attemptCount(): number {
		return this.props.attemptCount ?? 0;
	}

	set attemptCount(value: number) {
		this.props.attemptCount = value;
	}

	public canHaveChild(_childNode: AnyBoardNode): boolean {
		// Answers are leaves - nothing may ever be attached to them.
		return false;
	}
}

export const isAiQuestionAnswer = (reference: unknown): reference is AiQuestionAnswer =>
	reference instanceof AiQuestionAnswer;
