import { ContentElementType } from '../../domain';
import { mapElementFactory } from '../../testing';
import { MapElementResponseMapper } from './map-element-response.mapper';

describe(MapElementResponseMapper.name, () => {
	const mapper = MapElementResponseMapper.getInstance();

	it('should map excerpt and marker', () => {
		const element = mapElementFactory.build({ markerLatitude: 52.371, markerLongitude: 9.735 });

		const response = mapper.mapToResponse(element);

		expect(response).toEqual(
			expect.objectContaining({
				id: element.id,
				type: ContentElementType.MAP,
				content: {
					latitude: element.latitude,
					longitude: element.longitude,
					zoom: element.zoom,
					marker: { latitude: 52.371, longitude: 9.735 },
				},
			})
		);
	});

	it('should leave out the marker when none is set', () => {
		const element = mapElementFactory.build();

		const response = mapper.mapToResponse(element);

		expect(response.content.marker).toBeUndefined();
	});

	it('should only map map elements', () => {
		expect(mapper.canMap(mapElementFactory.build())).toBe(true);
		expect(mapper.canMap({})).toBe(false);
	});
});
