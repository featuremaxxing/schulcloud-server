import { Action, AuthorizationService } from '@modules/authorization';
import {
	BOARD_PUBLIC_API_CONFIG_TOKEN,
	type BoardNodeAuthorizable,
	BoardNodeAuthorizableService,
	BoardNodeType,
	type BoardProgressResult,
	BoardProgressService,
	type BoardPublicApiConfig,
	type ColumnBoard,
	ColumnBoardService,
	isTeacherMember,
} from '@modules/board';
import { BoardNodeRule, BoardOperation } from '@modules/board/authorisation/board-node.rule';
import { RoomMembershipService } from '@modules/room-membership';
import { RoomRule } from '@modules/room-membership/authorization/room.rule';
import { type User } from '@modules/user/repo';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils/wrap-with-exception';
import { EntityId } from '@shared/domain/types';
import { RoomBoardService, RoomPermissionService } from './service';

interface AuthorizedBoard {
	board: ColumnBoard;
	allowedOperations: Record<BoardOperation, boolean>;
	auth: BoardNodeAuthorizable;
}

@Injectable()
export class RoomContentUc {
	constructor(
		private readonly roomRule: RoomRule,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly roomPermissionService: RoomPermissionService,
		private readonly roomMembershipService: RoomMembershipService,
		private readonly roomBoardService: RoomBoardService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly authorizationService: AuthorizationService,
		private readonly columnBoardService: ColumnBoardService,
		private readonly boardProgressService: BoardProgressService,
		@Inject(BOARD_PUBLIC_API_CONFIG_TOKEN) private readonly boardConfig: BoardPublicApiConfig
	) {}

	public async getRoomBoards(userId: EntityId, roomId: EntityId): Promise<AuthorizedBoard[]> {
		await this.roomPermissionService.checkRoomIsLocked(roomId);

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const roomAuthorizable = await this.roomMembershipService.getRoomAuthorizable(roomId);

		throwForbiddenIfFalse(this.roomRule.can('accessRoomBoards', user, roomAuthorizable));

		const boards = await this.roomBoardService.getOrderedBoards(roomId);
		const authorizedBoards = await this.filterAuthorizedBoards(userId, boards);

		return authorizedBoards;
	}

	// Checkbox/assignment/poll completion progress, aggregated across every board the
	// caller can currently open in this room - own progress for a student, class
	// progress for a teacher (a board editor with the teacher school role), see
	// BoardProgressUc.isTeacherView for the board-scoped equivalent of this check.
	public async getRoomProgress(userId: EntityId, roomId: EntityId, details = false): Promise<BoardProgressResult[]> {
		this.checkFeatureEnabled();

		const authorizedBoards = await this.getRoomBoards(userId, roomId);
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boards = authorizedBoards.map(({ board, auth }) => {
			return {
				board,
				auth,
				isTeacherView: this.isTeacherView(user, auth, userId),
			};
		});

		const results = await this.boardProgressService.computeBoardsProgress(userId, boards, this.enabledTypes(), {
			includeStudents: details,
		});

		return results;
	}

	// The board-wide equivalent of CheckboxUc.state()'s canManage, minus the "is the
	// creator" check - see BoardProgressUc.isTeacherView for the same logic at board scope.
	private isTeacherView(user: User, auth: BoardNodeAuthorizable, userId: EntityId): boolean {
		const member = auth.users.find((candidate) => candidate.userId === userId);

		return !!member && isTeacherMember(member) && this.boardNodeRule.can('isBoardEditor', user, auth);
	}

	private enabledTypes(): BoardNodeType[] {
		const types: BoardNodeType[] = [];
		if (this.boardConfig.featureColumnBoardCheckboxEnabled) types.push(BoardNodeType.CHECKBOX_ELEMENT);
		if (this.boardConfig.featureColumnBoardAssignmentEnabled) types.push(BoardNodeType.ASSIGNMENT_ELEMENT);
		if (this.boardConfig.featureColumnBoardPollEnabled) types.push(BoardNodeType.POLL_ELEMENT);
		return types;
	}

	private checkFeatureEnabled(): void {
		if (!this.boardConfig.featureBoardProgressEnabled) {
			throw new ForbiddenException('Board progress is not enabled.');
		}
	}

	public async moveBoard(userId: EntityId, roomId: EntityId, boardId: EntityId, toPosition: number): Promise<void> {
		await this.roomPermissionService.checkRoomIsLocked(roomId);
		await this.roomPermissionService.checkRoomAuthorizationByIds(userId, roomId, Action.write);

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const roomAuthorizable = await this.roomMembershipService.getRoomAuthorizable(roomId);
		const board = await this.columnBoardService.findById(boardId);
		const boardAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(board);

		const canFindBoard = this.boardNodeRule.can('findBoard', user, boardAuthorizable);
		const canEditContent = this.roomRule.can('editContent', user, roomAuthorizable);

		throwForbiddenIfFalse(canFindBoard && canEditContent);

		await this.roomBoardService.moveBoardInRoom(roomId, boardId, toPosition);
	}

	private async filterAuthorizedBoards(userId: EntityId, boards: ColumnBoard[]): Promise<AuthorizedBoard[]> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const boardAuthorizables = await this.boardNodeAuthorizableService.getBoardAuthorizables(boards);

		const result: AuthorizedBoard[] = [];

		for (const board of boards) {
			const boardAuthorizable = boardAuthorizables.find((ba) => ba.boardNode.id === board.id);
			if (!boardAuthorizable) {
				continue;
			}
			if (this.boardNodeRule.can('findBoard', user, boardAuthorizable)) {
				const allowedOperations = this.boardNodeRule.listAllowedOperations(user, boardAuthorizable);
				result.push({ board, allowedOperations, auth: boardAuthorizable });
			}
		}

		return result;
	}
}
