import { CheckboxElement, ContentElementType } from '../../domain';
import { CheckboxElementContent, CheckboxElementResponse, TimestampsResponse } from '../dto';
import { type BaseResponseMapper } from './base-mapper.interface';

export class CheckboxElementResponseMapper implements BaseResponseMapper {
	private static instance: CheckboxElementResponseMapper;
	public static getInstance(): CheckboxElementResponseMapper {
		return (this.instance ??= new CheckboxElementResponseMapper());
	}
	public canMap(element: unknown): boolean {
		return element instanceof CheckboxElement;
	}
	public mapToResponse(element: CheckboxElement): CheckboxElementResponse {
		return new CheckboxElementResponse({
			id: element.id,
			type: ContentElementType.CHECKBOX,
			content: new CheckboxElementContent({
				text: element.text,
				requireTeacherConfirmation: element.requireTeacherConfirmation,
				audience: element.audience,
				audienceRoles: element.audienceRoles,
			}),
			timestamps: new TimestampsResponse({ createdAt: element.createdAt, lastUpdatedAt: element.updatedAt }),
		});
	}
}
