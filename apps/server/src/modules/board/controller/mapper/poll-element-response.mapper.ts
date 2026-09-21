import { ContentElementType, PollElement } from '../../domain';
import {
	PollElementContent,
	PollElementResponse,
	PollOptionResponse,
	PollQuestionResponse,
	PollQuestionResultResponse,
	PollResultCountResponse,
	PollResultSnapshotResponse,
	TimestampsResponse,
} from '../dto';
import { type BaseResponseMapper } from './base-mapper.interface';

export class PollElementResponseMapper implements BaseResponseMapper {
	private static instance: PollElementResponseMapper;

	public static getInstance(): PollElementResponseMapper {
		if (!PollElementResponseMapper.instance) {
			PollElementResponseMapper.instance = new PollElementResponseMapper();
		}

		return PollElementResponseMapper.instance;
	}

	public mapToResponse(element: PollElement): PollElementResponse {
		const result: PollElementResponse = new PollElementResponse({
			id: element.id,
			timestamps: new TimestampsResponse({ lastUpdatedAt: element.updatedAt, createdAt: element.createdAt }),
			type: ContentElementType.POLL,
			content: new PollElementContent({
				title: element.title,
				questions: element.questions.map(
					(question) =>
						new PollQuestionResponse({
							id: question.id,
							text: question.text,
							answerMode: question.answerMode,
							chartType: question.chartType,
							options: question.options.map((option) => new PollOptionResponse(option)),
						})
				),
				isAnonymous: element.isAnonymous,
				showResultsLive: element.showResultsLive,
				pollStatus: element.pollStatus,
				closesAt: element.closesAt?.toISOString() ?? null,
				audience: element.audience,
				audienceRoles: element.audienceRoles,
				resultSnapshot: element.resultSnapshot
					? new PollResultSnapshotResponse({
							frozenAt: element.resultSnapshot.frozenAt.toISOString(),
							participantCount: element.resultSnapshot.participantCount,
							perQuestion: element.resultSnapshot.perQuestion.map(
								(question) =>
									new PollQuestionResultResponse({
										questionId: question.questionId,
										counts: question.counts.map((count) => new PollResultCountResponse(count)),
										textAnswers: question.textAnswers,
									})
							),
						})
					: null,
			}),
		});

		return result;
	}

	public canMap(element: unknown): boolean {
		return element instanceof PollElement;
	}
}
