import { mapElementFactory } from '../testing';
import { MapElement } from './map-element.do';

describe(MapElement.name, () => {
	describe('when setting the view', () => {
		it('should store center and zoom', () => {
			const element = mapElementFactory.build();

			element.setView({ latitude: 48.137, longitude: 11.575, zoom: 13 });

			expect(element.latitude).toBe(48.137);
			expect(element.longitude).toBe(11.575);
			expect(element.zoom).toBe(13);
		});
	});

	describe('marker', () => {
		it('should have no marker by default', () => {
			const element = mapElementFactory.build();

			expect(element.marker).toBeUndefined();
		});

		it('should set and remove the marker', () => {
			const element = mapElementFactory.build();

			element.setMarker({ latitude: 52.37, longitude: 9.73 });
			expect(element.marker).toEqual({ latitude: 52.37, longitude: 9.73 });

			element.setMarker(undefined);
			expect(element.marker).toBeUndefined();
		});
	});

	it('should not have children', () => {
		const element = mapElementFactory.build();

		expect(element.canHaveChild()).toBe(false);
	});
});
