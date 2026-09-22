import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@infra/logger';
import { Test, type TestingModule } from '@nestjs/testing';
import { AiClientService } from './ai-client.service';
import { AI_CONFIG_TOKEN } from './ai.config';

describe(AiClientService.name, () => {
	let service: AiClientService;
	let fetchMock: jest.Mock;

	const config = {
		featureAiEnabled: true,
		aiClientApiKey: 'test-key',
		aiClientBaseUrl: 'https://ai.example.com/v4',
		aiClientModel: 'test-model',
		isConfigured: () => true,
	};

	beforeAll(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AiClientService,
				{ provide: AI_CONFIG_TOKEN, useValue: config },
				{ provide: Logger, useValue: createMock<Logger>() },
			],
		}).compile();

		service = module.get(AiClientService);
	});

	beforeEach(() => {
		jest.clearAllMocks();
		fetchMock = jest.fn();
		global.fetch = fetchMock as unknown as typeof fetch;
	});

	it('should POST an OpenAI-compatible chat completion with the configured model', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ choices: [{ message: { content: 'Richtig' } }] }), { status: 200 })
		);

		const result = await service.complete('system', 'user');

		expect(result).toBe('Richtig');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string) as {
			model: string;
			messages: { role: string; content: string }[];
		};
		expect(url).toBe('https://ai.example.com/v4/chat/completions');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer test-key' }));
		expect(body.model).toBe('test-model');
		expect(body.messages).toEqual([
			{ role: 'system', content: 'system' },
			{ role: 'user', content: 'user' },
		]);
	});

	it('should throw a service-unavailable error when the provider rejects the request', async () => {
		fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));

		await expect(service.complete('system', 'user')).rejects.toMatchObject({
			status: 503,
		});
	});

	it('should throw a service-unavailable error when the response has no content', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

		await expect(service.complete('system', 'user')).rejects.toMatchObject({
			status: 503,
		});
	});
});
