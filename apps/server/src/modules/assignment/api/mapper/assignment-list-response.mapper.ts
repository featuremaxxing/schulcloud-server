import { AssignmentStatus } from '@modules/board';
import { type AssignmentListEntry } from '../assignment.uc';
import { AssignmentListItemResponse, AssignmentListResponse } from '../dto';

export class AssignmentListResponseMapper {
	public static mapList(entries: AssignmentListEntry[]): AssignmentListResponse {
		return new AssignmentListResponse(entries.map((entry) => this.mapSingle(entry)));
	}

	private static mapSingle(entry: AssignmentListEntry): AssignmentListItemResponse {
		const { element } = entry;

		const shared = {
			id: element.id,
			roomId: entry.roomId,
			boardId: entry.boardId,
			title: element.title,
			startDate: element.startDate?.toISOString() ?? null,
			dueDate: element.dueDate?.toISOString() ?? null,
			lateUntil: element.lateUntil?.toISOString() ?? null,
			isStarted: element.isStartedAt(new Date()),
			isSubmittable: element.isSubmittable(new Date()),
			maxPoints: element.maxPoints ?? null,
		};

		if (entry.isTeacher) {
			return new AssignmentListItemResponse({
				...shared,
				submissionsSubmitted: entry.submissions.filter((s) => s.getStatus() !== AssignmentStatus.OPEN).length,
				submissionsTotal: entry.submissions.length,
				ownSubmissionStatus: null,
				ownSubmissionIsLate: null,
			});
		}

		// for students the UC already reduced the list to the caller's own submission
		const own = entry.submissions[0];
		return new AssignmentListItemResponse({
			...shared,
			submissionsSubmitted: null,
			submissionsTotal: null,
			ownSubmissionStatus: own ? own.getStatus() : null,
			ownSubmissionIsLate: own ? own.isLate : null,
		});
	}
}
