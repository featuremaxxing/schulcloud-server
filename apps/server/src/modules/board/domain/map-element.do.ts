import { BoardNode } from './board-node.do';
import type { MapElementProps } from './types';

export interface MapMarker {
	latitude: number;
	longitude: number;
}

// an excerpt of an OpenStreetMap map: the visible center and zoom level,
// optionally with one marker (e.g. the meeting point of an excursion)
export class MapElement extends BoardNode<MapElementProps> {
	get latitude(): number {
		return this.props.latitude;
	}

	get longitude(): number {
		return this.props.longitude;
	}

	get zoom(): number {
		return this.props.zoom;
	}

	get marker(): MapMarker | undefined {
		const { markerLatitude, markerLongitude } = this.props;
		if (markerLatitude === undefined || markerLongitude === undefined) return undefined;
		return { latitude: markerLatitude, longitude: markerLongitude };
	}

	public setView(view: { latitude: number; longitude: number; zoom: number }): void {
		this.props.latitude = view.latitude;
		this.props.longitude = view.longitude;
		this.props.zoom = view.zoom;
	}

	public setMarker(marker: MapMarker | undefined): void {
		this.props.markerLatitude = marker?.latitude;
		this.props.markerLongitude = marker?.longitude;
	}

	public canHaveChild(): boolean {
		return false;
	}
}

export const isMapElement = (reference: unknown): reference is MapElement => reference instanceof MapElement;
