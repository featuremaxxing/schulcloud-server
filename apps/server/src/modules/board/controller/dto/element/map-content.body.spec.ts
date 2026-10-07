import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContentElementType } from '../../../domain';
import { MapContentBody, UpdateElementContentBodyParams } from './update-element-content.body.params';

describe('UpdateElementContentBodyParams for map elements', () => {
	const validateContent = async (content: Record<string, unknown>) => {
		const params = plainToInstance(UpdateElementContentBodyParams, {
			data: { type: ContentElementType.MAP, content },
		});
		const errors = await validate(params);
		return { params, errors };
	};

	it('should accept an excerpt with a marker', async () => {
		const { params, errors } = await validateContent({
			latitude: 52.37,
			longitude: 9.73,
			zoom: 13,
			marker: { latitude: 52.371, longitude: 9.735 },
		});

		expect(errors).toHaveLength(0);
		expect(params.data.content).toBeInstanceOf(MapContentBody);
	});

	it('should accept an excerpt without a marker', async () => {
		const { errors } = await validateContent({ latitude: 52.37, longitude: 9.73, zoom: 13 });

		expect(errors).toHaveLength(0);
	});

	it.each([
		['latitude out of range', { latitude: 91, longitude: 9.73, zoom: 13 }],
		['longitude out of range', { latitude: 52.37, longitude: -181, zoom: 13 }],
		['zoom above the OpenStreetMap maximum', { latitude: 52.37, longitude: 9.73, zoom: 20 }],
		['fractional zoom', { latitude: 52.37, longitude: 9.73, zoom: 12.5 }],
		['missing zoom', { latitude: 52.37, longitude: 9.73 }],
		['coordinates as strings', { latitude: '52.37', longitude: '9.73', zoom: 13 }],
		['marker out of range', { latitude: 52.37, longitude: 9.73, zoom: 13, marker: { latitude: 100, longitude: 9.7 } }],
		['incomplete marker', { latitude: 52.37, longitude: 9.73, zoom: 13, marker: { latitude: 52.37 } }],
	])('should reject %s', async (_, content) => {
		const { errors } = await validateContent(content);

		expect(errors.length).toBeGreaterThan(0);
	});
});
