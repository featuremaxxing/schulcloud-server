import { type BoardProgressResult, type ProgressItemResult, type ProgressItemType } from '../../service';
import {
	type BoardProgressResponse,
	ProgressElementType,
	type ProgressItemResponse,
	type RoomProgressResponse,
} from '../dto/progress';

const elementTypeOf = (type: ProgressItemType): ProgressElementType => {
	switch (type) {
		case 'checkbox':
			return ProgressElementType.CHECKBOX;
		case 'assignment':
			return ProgressElementType.ASSIGNMENT;
		default:
			return ProgressElementType.POLL;
	}
};

// These response DTOs carry only @ApiProperty()-decorated fields for swagger, with no
// constructor - so the mapper builds plain object literals matching their shape, the same
// way CheckboxUc.state()/CheckboxStateResponse are handled.
export class ProgressResponseMapper {
	public static mapItem(item: ProgressItemResult): ProgressItemResponse {
		return {
			type: elementTypeOf(item.type),
			elementId: item.elementId,
			cardId: item.cardId,
			cardTitle: item.cardTitle,
			title: item.title,
			dueDate: item.dueDate,
			eligible: item.eligible,
			done: item.done,
			doneCount: item.doneCount,
			eligibleCount: item.eligibleCount,
			students: item.students,
		};
	}

	public static mapBoard(result: BoardProgressResult): BoardProgressResponse {
		return {
			boardId: result.boardId,
			boardTitle: result.boardTitle,
			isTeacherView: result.isTeacherView,
			summary: result.summary,
			items: result.items.map((item) => this.mapItem(item)),
		};
	}

	public static mapRoom(roomId: string, results: BoardProgressResult[]): RoomProgressResponse {
		const boards = results.map((result) => this.mapBoard(result));
		const summary = {
			done: results.reduce((sum, result) => sum + result.summary.done, 0),
			total: results.reduce((sum, result) => sum + result.summary.total, 0),
		};

		return { roomId, summary, boards };
	}
}
