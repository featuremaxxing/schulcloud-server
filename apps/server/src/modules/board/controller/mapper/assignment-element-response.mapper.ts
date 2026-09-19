import { AssignmentElement, ContentElementType } from '../../domain';
import {
	AssignmentElementContent,
	AssignmentElementResponse,
	AssignmentRubricCriterionResponse,
	TimestampsResponse,
} from '../dto';
import { type BaseResponseMapper } from './base-mapper.interface';

export class AssignmentElementResponseMapper implements BaseResponseMapper {
	private static instance: AssignmentElementResponseMapper;

	public static getInstance(): AssignmentElementResponseMapper {
		if (!AssignmentElementResponseMapper.instance) {
			AssignmentElementResponseMapper.instance = new AssignmentElementResponseMapper();
		}

		return AssignmentElementResponseMapper.instance;
	}

	public mapToResponse(element: AssignmentElement): AssignmentElementResponse {
		const result: AssignmentElementResponse = new AssignmentElementResponse({
			id: element.id,
			timestamps: new TimestampsResponse({ lastUpdatedAt: element.updatedAt, createdAt: element.createdAt }),
			type: ContentElementType.ASSIGNMENT,
			content: new AssignmentElementContent({
				title: element.title,
				text: element.text,
				inputFormat: element.inputFormat,
				startDate: element.startDate?.toISOString() ?? null,
				dueDate: element.dueDate?.toISOString() ?? null,
				graceMinutes: element.graceMinutes ?? null,
				maxPoints: element.maxPoints ?? null,
				lateUntil: element.lateUntil?.toISOString() ?? null,
				criteria: element.criteria?.map((criterion) => new AssignmentRubricCriterionResponse(criterion)) ?? null,
				peerReviewEnabled: element.peerReviewEnabled,
				peerReviewMode: element.peerReviewMode,
				peerReviewCount: element.peerReviewCount,
			}),
		});

		return result;
	}

	public canMap(element: unknown): boolean {
		return element instanceof AssignmentElement;
	}
}
