import { AiQuestionElement, ContentElementType } from '../../domain';
import { AiQuestionElementContent, AiQuestionElementResponse, TimestampsResponse } from '../dto';
import { type BaseResponseMapper } from './base-mapper.interface';

export class AiQuestionElementResponseMapper implements BaseResponseMapper {
	private static instance: AiQuestionElementResponseMapper;

	public static getInstance(): AiQuestionElementResponseMapper {
		if (!AiQuestionElementResponseMapper.instance) {
			AiQuestionElementResponseMapper.instance = new AiQuestionElementResponseMapper();
		}

		return AiQuestionElementResponseMapper.instance;
	}

	public mapToResponse(element: AiQuestionElement): AiQuestionElementResponse {
		const result: AiQuestionElementResponse = new AiQuestionElementResponse({
			id: element.id,
			timestamps: new TimestampsResponse({ lastUpdatedAt: element.updatedAt, createdAt: element.createdAt }),
			type: ContentElementType.AI_QUESTION,
			content: new AiQuestionElementContent({
				question: element.question,
				allowMultipleAttempts: element.allowMultipleAttempts,
				creatorId: element.creatorId,
				onlyCreatorCanEdit: element.onlyCreatorCanEdit,
				gradeLevel: element.gradeLevel,
				subject: element.subject,
				maxPoints: element.maxPoints,
			}),
		});

		return result;
	}

	public canMap(element: unknown): boolean {
		return element instanceof AiQuestionElement;
	}
}
