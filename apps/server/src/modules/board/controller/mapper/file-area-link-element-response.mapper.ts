import { ContentElementType, FileAreaLinkElement } from '../../domain';
import { FileAreaLinkElementContent, FileAreaLinkElementResponse, TimestampsResponse } from '../dto';
import type { BaseResponseMapper } from './base-mapper.interface';

export class FileAreaLinkElementResponseMapper implements BaseResponseMapper {
	private static instance: FileAreaLinkElementResponseMapper;

	public static getInstance(): FileAreaLinkElementResponseMapper {
		return (this.instance ??= new FileAreaLinkElementResponseMapper());
	}

	public canMap(element: unknown): element is FileAreaLinkElement {
		return element instanceof FileAreaLinkElement;
	}

	public mapToResponse(element: FileAreaLinkElement): FileAreaLinkElementResponse {
		return new FileAreaLinkElementResponse({
			id: element.id,
			type: ContentElementType.FILE_AREA_LINK,
			content: new FileAreaLinkElementContent({
				fileAreaId: element.fileAreaId,
				targetType: element.targetType,
				targetId: element.targetId,
				title: element.title,
			}),
			timestamps: new TimestampsResponse({ createdAt: element.createdAt, lastUpdatedAt: element.updatedAt }),
		});
	}
}
