import { columnBoardFactory, columnFactory, fileAreaFolderFactory } from '../testing';
import { BoardLayout } from './types';

describe('FileAreaFolder', () => {
	describe('canHaveChild', () => {
		it('should allow folders as children', () => {
			expect(fileAreaFolderFactory.build().canHaveChild(fileAreaFolderFactory.build())).toBe(true);
		});

		it('should not allow columns as children', () => {
			expect(fileAreaFolderFactory.build().canHaveChild(columnFactory.build())).toBe(false);
		});
	});

	describe('file area board', () => {
		it('should only take folders when the layout is FILES', () => {
			const board = columnBoardFactory.build({ layout: BoardLayout.FILES });

			expect(board.isFileArea()).toBe(true);
			expect(board.canHaveChild(fileAreaFolderFactory.build())).toBe(true);
			expect(board.canHaveChild(columnFactory.build())).toBe(false);
		});

		it('should only take columns for other layouts', () => {
			const board = columnBoardFactory.build({ layout: BoardLayout.COLUMNS });

			expect(board.isFileArea()).toBe(false);
			expect(board.canHaveChild(columnFactory.build())).toBe(true);
			expect(board.canHaveChild(fileAreaFolderFactory.build())).toBe(false);
		});
	});
});
