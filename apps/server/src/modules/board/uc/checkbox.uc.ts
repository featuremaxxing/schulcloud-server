import { AuthorizationService } from '@modules/authorization';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { BoardNodeAuthorizable, CheckboxElement, isCheckboxElement, isEligibleVoter, isTeacherMember } from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService } from '../service';

export interface CheckboxState {
	entries?: { userId: string; firstName?: string; lastName?: string; checked: boolean; approved: boolean }[];
	myEntry?: { checked: boolean; approved: boolean };
	canManage: boolean;
	hasCheckActivity: boolean;
}

@Injectable()
export class CheckboxUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeRule: BoardNodeRule
	) {}

	private async access(
		userId: EntityId,
		elementId: EntityId
	): Promise<{ element: CheckboxElement; auth: BoardNodeAuthorizable; canManage: boolean }> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const candidate = await this.boardNodeService.findContentElementById(elementId, 0);
		if (!isCheckboxElement(candidate)) throw new NotFoundException('Checkbox element not found');
		const auth = await this.boardNodeAuthorizableService.getBoardAuthorizable(candidate);
		throwForbiddenIfFalse(this.boardNodeRule.can('viewElement', user, auth));
		const canManage =
			candidate.creatorId === userId &&
			this.boardNodeRule.can('isBoardEditor', user, auth) &&
			!!auth.users.find((m) => m.userId === userId && isTeacherMember(m));
		return { element: candidate, auth, canManage };
	}

	private state(
		userId: EntityId,
		element: CheckboxElement,
		auth: BoardNodeAuthorizable,
		canManage: boolean
	): CheckboxState {
		const myEntry = element.entries.find((e) => e.userId === userId);
		const canCheck = auth.users.some(
			(member) => member.userId === userId && member.userId !== element.creatorId && isEligibleVoter(element, member)
		);
		return {
			canManage,
			hasCheckActivity: element.entries.length > 0,
			myEntry: canCheck ? { checked: myEntry?.checked ?? false, approved: myEntry?.approved ?? false } : undefined,
			entries: canManage
				? auth.users
						.filter((member) => member.userId !== element.creatorId && isEligibleVoter(element, member))
						.map((member) => {
							const entry = element.entries.find((e) => e.userId === member.userId);
							return {
								userId: member.userId,
								firstName: member.firstName,
								lastName: member.lastName,
								checked: entry?.checked ?? false,
								approved: entry?.approved ?? false,
							};
						})
				: undefined,
		};
	}

	public async get(userId: EntityId, elementId: EntityId): Promise<CheckboxState> {
		const { element, auth, canManage } = await this.access(userId, elementId);
		return this.state(userId, element, auth, canManage);
	}

	public async check(userId: EntityId, elementId: EntityId, checked: boolean): Promise<CheckboxState> {
		const { element, auth, canManage } = await this.access(userId, elementId);
		throwForbiddenIfFalse(
			!auth.boardConfiguration.isLocked &&
				!!auth.users.find(
					(member) =>
						member.userId === userId && member.userId !== element.creatorId && isEligibleVoter(element, member)
				)
		);
		element.entries = await this.boardNodeService.mutateCheckboxEntries(elementId, (entries) => {
			const existing = entries.find((e) => e.userId === userId);
			if (existing?.approved && existing.checked !== checked) {
				throw new ForbiddenException('Teacher confirmation must be revoked before changing a checked item');
			}
			if (existing && existing.checked !== checked) {
				existing.checked = checked;
				existing.approved = false;
			} else if (!existing) {
				entries.push({ userId, checked, approved: false });
			}
			return entries;
		});
		return this.state(userId, element, auth, canManage);
	}

	public async approve(
		userId: EntityId,
		elementId: EntityId,
		studentId: EntityId,
		approved: boolean
	): Promise<CheckboxState> {
		const { element, auth, canManage } = await this.access(userId, elementId);
		throwForbiddenIfFalse(canManage);
		if (
			!auth.users.some(
				(member) =>
					member.userId === studentId && member.userId !== element.creatorId && isEligibleVoter(element, member)
			)
		)
			throw new NotFoundException('Participant not found');
		if (!element.requireTeacherConfirmation) throw new ForbiddenException('Teacher confirmation is disabled');
		element.entries = await this.boardNodeService.mutateCheckboxEntries(elementId, (entries) => {
			const entry = entries.find((e) => e.userId === studentId);
			if (!entry?.checked) throw new ForbiddenException('Student has not checked this item');
			entry.approved = approved;
			return entries;
		});
		return this.state(userId, element, auth, canManage);
	}
}
