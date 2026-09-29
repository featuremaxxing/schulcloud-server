import { InternalServerErrorException } from '@nestjs/common';
import type { EntityId } from '@shared/domain/types';
import { type BoardOperation } from '../../authorisation/board-node.rule';
import { type BoardFeature, Column, type ColumnBoard } from '../../domain';
import { BoardResponse, TimestampsResponse } from '../dto';
import { ColumnResponseMapper } from './column-response.mapper';

export class BoardResponseMapper {
	public static mapToResponse(
		board: ColumnBoard,
		features: BoardFeature[],
		allowedOperations: Record<BoardOperation, boolean>,
		pinnedCardOrigins?: Map<EntityId, string>
	): BoardResponse {
		const result = new BoardResponse({
			id: board.id,
			title: board.title,
			// a file area has folders instead of columns, they are served by the file area endpoints
			columns: board.isFileArea()
				? []
				: board.children.map((column) => {
						/* istanbul ignore next */
						if (!(column instanceof Column)) {
							throw new InternalServerErrorException(`unsupported child type: ${column.constructor.name}`);
						}
						return ColumnResponseMapper.mapToResponse(column, pinnedCardOrigins);
					}),
			timestamps: new TimestampsResponse({ lastUpdatedAt: board.updatedAt, createdAt: board.createdAt }),
			isVisible: board.isVisible,
			readersCanEdit: board.readersCanEdit,
			layout: board.layout,
			features,
			allowedOperations,
		});
		return result;
	}
}
