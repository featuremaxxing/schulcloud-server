import { AuthorizationService } from '@modules/authorization';
import { type User } from '@modules/user/repo';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '../board.config';
import { BoardNodeAuthorizable, BoardNodeType, ColumnBoard, isTeacherMember } from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService, BoardProgressResult, BoardProgressService } from '../service';

@Injectable()
export class BoardProgressUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly boardProgressService: BoardProgressService,
		@Inject(BOARD_CONFIG_TOKEN) private readonly config: BoardConfig
	) {}

	public async getBoardProgress(userId: EntityId, boardId: EntityId, details = false): Promise<BoardProgressResult> {
		this.checkFeatureEnabled();

		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, boardId);
		const auth = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);
		const user = await this.authorizationService.getUserWithPermissions(userId);

		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, auth));

		const isTeacherView = this.isTeacherView(user, auth, userId);

		const [result] = await this.boardProgressService.computeBoardsProgress(
			userId,
			[{ board, auth, isTeacherView }],
			this.enabledTypes(),
			{ includeStudents: details && isTeacherView }
		);

		return result;
	}

	// The board-wide equivalent of CheckboxUc.state()'s canManage, minus the "is the
	// creator" check, which has no meaning at board scope: a board editor who is also a
	// teacher manages the class-wide progress view, everyone else sees only their own.
	private isTeacherView(user: User, auth: BoardNodeAuthorizable, userId: EntityId): boolean {
		const member = auth.users.find((candidate) => candidate.userId === userId);

		return !!member && isTeacherMember(member) && this.boardNodeRule.can('isBoardEditor', user, auth);
	}

	private enabledTypes(): BoardNodeType[] {
		const types: BoardNodeType[] = [];
		if (this.config.featureColumnBoardCheckboxEnabled) types.push(BoardNodeType.CHECKBOX_ELEMENT);
		if (this.config.featureColumnBoardAssignmentEnabled) types.push(BoardNodeType.ASSIGNMENT_ELEMENT);
		if (this.config.featureColumnBoardPollEnabled) types.push(BoardNodeType.POLL_ELEMENT);
		return types;
	}

	private checkFeatureEnabled(): void {
		if (!this.config.featureBoardProgressEnabled) {
			throw new ForbiddenException('Board progress is not enabled.');
		}
	}
}
