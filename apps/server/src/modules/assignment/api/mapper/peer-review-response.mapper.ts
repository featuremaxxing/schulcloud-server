import { type AssignmentElement } from '@modules/board';
import { PeerReviewSettingsResponse, PeerReviewTaskFileResponse, PeerReviewTaskResponse } from '../dto';
import { type PeerReviewTaskResult } from '../peer-review.uc';

export class PeerReviewResponseMapper {
	public static mapSettings(element: AssignmentElement): PeerReviewSettingsResponse {
		return new PeerReviewSettingsResponse({
			enabled: element.peerReviewEnabled,
			mode: element.peerReviewMode,
			count: element.peerReviewCount,
		});
	}

	// Deliberately does not accept anything the caller could use to identify the submission's
	// owner - only ever construct this from a PeerReviewTaskResult (review + file).
	public static mapTask(result: PeerReviewTaskResult): PeerReviewTaskResponse {
		return new PeerReviewTaskResponse({
			id: result.review.id,
			submissionId: result.review.submissionId,
			file: result.file
				? new PeerReviewTaskFileResponse({ fileRecordId: result.file.id, name: result.file.name })
				: null,
			assignedAt: result.review.assignedAt.toISOString(),
			submittedAt: result.review.submittedAt?.toISOString() ?? null,
			points: result.review.points ?? null,
			feedbackComment: result.review.feedbackComment ?? null,
		});
	}
}
