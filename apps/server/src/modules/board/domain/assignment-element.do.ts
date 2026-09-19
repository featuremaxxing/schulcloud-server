import { type InputFormat } from '@shared/domain/types';
import { BoardNode } from './board-node.do';
import { isAssignmentSubmission } from './assignment-submission.do';
import type { AnyBoardNode, AssignmentElementProps, AssignmentRubricCriterion } from './types';

export class AssignmentElement extends BoardNode<AssignmentElementProps> {
	get title(): string {
		return this.props.title;
	}

	set title(value: string) {
		this.props.title = value;
	}

	get text(): string {
		return this.props.text;
	}

	set text(value: string) {
		this.props.text = value;
	}

	get inputFormat(): InputFormat {
		return this.props.inputFormat;
	}

	set inputFormat(value: InputFormat) {
		this.props.inputFormat = value;
	}

	get startDate(): Date | undefined {
		return this.props.startDate;
	}

	set startDate(value: Date | undefined) {
		this.props.startDate = value;
	}

	get dueDate(): Date | undefined {
		return this.props.dueDate;
	}

	set dueDate(value: Date | undefined) {
		this.props.dueDate = value;
	}

	get graceMinutes(): number | undefined {
		return this.props.graceMinutes;
	}

	set graceMinutes(value: number | undefined) {
		this.props.graceMinutes = value;
	}

	get maxPoints(): number | undefined {
		return this.props.maxPoints;
	}

	set maxPoints(value: number | undefined) {
		this.props.maxPoints = value;
	}

	// The rubric, when the teacher configured one - empty/undefined means "no rubric",
	// the flat maxPoints/points fields are then the only grading model in use.
	get criteria(): AssignmentRubricCriterion[] | undefined {
		return this.props.criteria;
	}

	set criteria(value: AssignmentRubricCriterion[] | undefined) {
		this.props.criteria = value;
	}

	get peerReviewEnabled(): boolean {
		return this.props.peerReviewEnabled ?? false;
	}

	set peerReviewEnabled(value: boolean) {
		this.props.peerReviewEnabled = value;
	}

	get peerReviewMode(): 'manual' | 'auto' {
		return this.props.peerReviewMode ?? 'manual';
	}

	set peerReviewMode(value: 'manual' | 'auto') {
		this.props.peerReviewMode = value;
	}

	get peerReviewCount(): number {
		return this.props.peerReviewCount ?? 1;
	}

	set peerReviewCount(value: number) {
		this.props.peerReviewCount = value;
	}

	// The point in time until a (still open) submission may be created or replaced.
	// Later than dueDate by graceMinutes, marking the submission as late in the process.
	get lateUntil(): Date | undefined {
		if (!this.dueDate) {
			return undefined;
		}

		const graceMs = (this.graceMinutes ?? 0) * 60 * 1000;

		return new Date(this.dueDate.getTime() + graceMs);
	}

	// Whether the assignment has started yet, per its own startDate. Independent of
	// isSubmittable, which additionally accounts for the deadline/grace period.
	public isStartedAt(now: Date): boolean {
		if (!this.startDate) {
			return true;
		}

		return now.getTime() >= this.startDate.getTime();
	}

	public isSubmittable(now: Date): boolean {
		if (!this.isStartedAt(now)) {
			return false;
		}

		const { lateUntil } = this;

		if (!lateUntil) {
			return true;
		}

		return now.getTime() <= lateUntil.getTime();
	}

	public isLateAt(now: Date): boolean {
		if (!this.dueDate) {
			return false;
		}

		return now.getTime() > this.dueDate.getTime();
	}

	public canHaveChild(childNode: AnyBoardNode): boolean {
		return isAssignmentSubmission(childNode);
	}
}

export const isAssignmentElement = (reference: unknown): reference is AssignmentElement =>
	reference instanceof AssignmentElement;
