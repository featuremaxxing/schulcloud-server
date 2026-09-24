import { BoardNode } from './board-node.do';
import { type BoardRoles } from './board-node-authorizable.do';
import { type AnyBoardNode, type CheckboxElementProps, type CheckboxEntry, PollAudience } from './types';

export class CheckboxElement extends BoardNode<CheckboxElementProps> {
	get text(): string {
		return this.props.text;
	}
	set text(value: string) {
		this.props.text = value;
	}
	get requireTeacherConfirmation(): boolean {
		return this.props.requireTeacherConfirmation ?? false;
	}
	set requireTeacherConfirmation(value: boolean) {
		this.props.requireTeacherConfirmation = value;
	}
	get creatorId(): string | undefined {
		return this.props.creatorId;
	}
	get audience(): PollAudience {
		return this.props.audience ?? PollAudience.STUDENTS;
	}
	set audience(value: PollAudience) {
		this.props.audience = value;
	}
	get audienceRoles(): BoardRoles[] | undefined {
		return this.props.audienceRoles;
	}
	set audienceRoles(value: BoardRoles[] | undefined) {
		this.props.audienceRoles = value;
	}
	get entries(): CheckboxEntry[] {
		return this.props.entries ?? [];
	}
	set entries(value: CheckboxEntry[]) {
		this.props.entries = value;
	}
	public canHaveChild(_childNode: AnyBoardNode): boolean {
		return false;
	}
}

export const isCheckboxElement = (value: unknown): value is CheckboxElement => value instanceof CheckboxElement;

// Parent deletion/move must not bypass the element's teacher-author ownership rule.
export const canManageCheckboxDescendants = (node: AnyBoardNode, userId: string): boolean =>
	node.getChildrenOfType(CheckboxElement).every((checkbox) => checkbox.creatorId === userId);
