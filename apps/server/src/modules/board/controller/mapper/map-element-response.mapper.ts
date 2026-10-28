import { ContentElementType, MapElement } from '../../domain';
import { MapElementContent, MapElementResponse, MapMarkerResponse, TimestampsResponse } from '../dto';
import type { BaseResponseMapper } from './base-mapper.interface';

export class MapElementResponseMapper implements BaseResponseMapper {
	private static instance: MapElementResponseMapper;

	public static getInstance(): MapElementResponseMapper {
		return (this.instance ??= new MapElementResponseMapper());
	}

	public canMap(element: unknown): element is MapElement {
		return element instanceof MapElement;
	}

	public mapToResponse(element: MapElement): MapElementResponse {
		const { marker } = element;
		return new MapElementResponse({
			id: element.id,
			type: ContentElementType.MAP,
			content: new MapElementContent({
				latitude: element.latitude,
				longitude: element.longitude,
				zoom: element.zoom,
				marker: marker ? new MapMarkerResponse(marker) : undefined,
			}),
			timestamps: new TimestampsResponse({ createdAt: element.createdAt, lastUpdatedAt: element.updatedAt }),
		});
	}
}
