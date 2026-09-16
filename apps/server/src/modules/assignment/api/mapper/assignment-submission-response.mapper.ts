import { AssignmentStatus } from '@modules/board';
import {
	AssignmentSubmissionListResponse,
	AssignmentSubmissionResponse,
	AssignmentSubmissionFileResponse,
} from '../dto';
import {
	type AssignmentSubmissionEntry,
	type AssignmentSubmissionResult,
	type AssignmentSubmissionsListResult,
} from '../assignment.uc';

export class AssignmentSubmissionResponseMapper {
	// Full detail, used for the teacher's view of any student's row.
	public static mapForTeacher(entry: AssignmentSubmissionEntry): AssignmentSubmissionResponse {
		return new AssignmentSubmissionResponse({
			id: entry.submission?.id ?? null,
			userId: entry.userId,
			firstName: entry.firstName,
			lastName: entry.lastName,
			status: entry.submission?.getStatus() ?? AssignmentStatus.OPEN,
			submittedAt: entry.submission?.submittedAt?.toISOString() ?? null,
			isLate: entry.submission?.isLate ?? false,
			file: mapFile(entry.file),
			points: entry.submission?.points ?? null,
			feedbackComment: entry.submission?.feedbackComment ?? null,
			returnedAt: entry.submission?.returnedAt?.toISOString() ?? null,
			comment: entry.submission?.comment ?? null,
			feedbackAudio: mapFile(entry.feedbackAudio),
		});
	}

	// Used for a student's view of their own submission. Withholds points/feedbackComment
	// until the teacher has returned the submission - enforced here on the server, never
	// only by hiding it in the client. See AGENTS notes / plan §5.3.
	public static mapForOwner(entry: AssignmentSubmissionEntry): AssignmentSubmissionResponse {
		const isReturned = entry.submission?.returnedAt !== undefined;

		return new AssignmentSubmissionResponse({
			id: entry.submission?.id ?? null,
			userId: entry.userId,
			status: entry.submission?.getStatus() ?? AssignmentStatus.OPEN,
			submittedAt: entry.submission?.submittedAt?.toISOString() ?? null,
			isLate: entry.submission?.isLate ?? false,
			file: mapFile(entry.file),
			points: isReturned ? (entry.submission?.points ?? null) : null,
			feedbackComment: isReturned ? (entry.submission?.feedbackComment ?? null) : null,
			returnedAt: entry.submission?.returnedAt?.toISOString() ?? null,
			comment: entry.submission?.comment ?? null,
			// the audio feedback follows the same release rule as points/comment
			feedbackAudio: isReturned ? mapFile(entry.feedbackAudio) : null,
		});
	}

	public static mapSingleForOwner(result: AssignmentSubmissionResult): AssignmentSubmissionResponse {
		return this.mapForOwner({
			userId: result.submission.userId,
			submission: result.submission,
			file: result.file,
			feedbackAudio: result.feedbackAudio,
		});
	}

	// Names are omitted here: the teacher already knows whom they are grading from the list
	// view that led them here, so a name lookup for this single-item response is not worth
	// the extra query.
	public static mapSingleForTeacher(result: AssignmentSubmissionResult): AssignmentSubmissionResponse {
		return this.mapForTeacher({
			userId: result.submission.userId,
			submission: result.submission,
			file: result.file,
			feedbackAudio: result.feedbackAudio,
		});
	}

	public static mapList(result: AssignmentSubmissionsListResult): AssignmentSubmissionListResponse {
		const submissions = result.entries.map((entry) =>
			result.isTeacher ? this.mapForTeacher(entry) : this.mapForOwner(entry)
		);

		return new AssignmentSubmissionListResponse({
			maxPoints: result.element.maxPoints ?? null,
			dueDate: result.element.dueDate?.toISOString() ?? null,
			lateUntil: result.element.lateUntil?.toISOString() ?? null,
			isSubmittable: result.element.isSubmittable(new Date()),
			submissions,
		});
	}
}

const mapFile = (file: AssignmentSubmissionEntry['file']): AssignmentSubmissionFileResponse | null => {
	if (!file) {
		return null;
	}

	return new AssignmentSubmissionFileResponse({ fileRecordId: file.id, name: file.name });
};
