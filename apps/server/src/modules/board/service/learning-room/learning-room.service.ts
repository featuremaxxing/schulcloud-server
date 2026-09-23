import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import {
	BoardExternalReference,
	BoardExternalReferenceType,
	BoardLayout,
	ColumnBoard,
	BoardNodeFactory,
	isColumnBoard,
	PinnedCard,
} from '../../domain';
import { BoardNodeRepo } from '../../repo';

export const DEFAULT_COLUMN_TITLES = ['To-do', 'Dran', 'Erledigt'];
export const DEFAULT_BOARD_TITLE = 'Mein Lernraum';

@Injectable()
export class LearningRoomService {
	constructor(
		private readonly boardNodeRepo: BoardNodeRepo,
		private readonly boardNodeFactory: BoardNodeFactory
	) {}

	/**
	 * The personal learning room is a regular ColumnBoard owned by the user, the
	 * same way the media shelf is a personal MediaBoard. It is created on first
	 * access, including its default columns.
	 *
	 * The column titles are created here rather than in the client because a card
	 * can be pinned before the learning room has ever been opened - there would be
	 * no column to pin into. They are plain, renamable columns afterwards.
	 */
	public async getOrCreatePersonalLearningRoomOfUser(userId: EntityId): Promise<ColumnBoard> {
		const context: BoardExternalReference = {
			type: BoardExternalReferenceType.User,
			id: userId,
		};

		// A user context can hold more than one board - the media shelf uses the very
		// same reference - so filtering by type is required, not cosmetic.
		const existingBoards = await this.boardNodeRepo.findByExternalReference(context);
		const existingLearningRooms = existingBoards.filter(isColumnBoard);

		if (existingLearningRooms.length) {
			const board = existingLearningRooms[0];

			// boards created before the title existed would render headerless
			if (board.title === '') {
				board.title = DEFAULT_BOARD_TITLE;
				await this.boardNodeRepo.save(board);
			}

			return board;
		}

		const board = this.boardNodeFactory.buildColumnBoard({
			context,
			title: DEFAULT_BOARD_TITLE,
			layout: BoardLayout.COLUMNS,
		});
		// personal board: nobody else can ever see it, so it is visible from the start
		board.isVisible = true;

		DEFAULT_COLUMN_TITLES.forEach((title) => {
			const column = this.boardNodeFactory.buildColumn();
			column.title = title;
			board.addChild(column);
		});

		await this.boardNodeRepo.save(board);

		return board;
	}

	public findPinnedCards(board: ColumnBoard): PinnedCard[] {
		const pinnedCards = board.getChildrenOfType(PinnedCard);

		return pinnedCards;
	}

	public findPinnedCardByReference(board: ColumnBoard, referencedCardId: EntityId): PinnedCard | undefined {
		const pinnedCard = this.findPinnedCards(board).find((node) => node.referencedCardId === referencedCardId);

		return pinnedCard;
	}
}
