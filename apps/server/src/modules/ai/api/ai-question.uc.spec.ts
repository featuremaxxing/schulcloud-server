import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@infra/logger';
import {
	type AiQuestionElement,
	BoardNodeAuthorizableService,
	BoardNodeFactory,
	BoardNodeRule,
	BoardNodeService,
} from '@modules/board';
import { AuthorizationService } from '@modules/authorization';
import { userFactory } from '@modules/user/testing';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
	boardNodeAuthorizableFactory,
	aiQuestionAnswerFactory,
	aiQuestionElementFactory,
} from '@modules/board/testing';
import { AI_CONFIG_TOKEN, type AiConfig } from '../ai.config';
import { AiClientService } from '../ai-client.service';
import { AiQuestionUc } from './ai-question.uc';

describe(AiQuestionUc.name, () => {
	let module: TestingModule;
	let uc: AiQuestionUc;
	let boardNodeService: DeepMocked<BoardNodeService>;
	let boardNodeAuthorizableService: DeepMocked<BoardNodeAuthorizableService>;
	let boardNodeRule: DeepMocked<BoardNodeRule>;
	let boardNodeFactory: DeepMocked<BoardNodeFactory>;
	let authorizationService: DeepMocked<AuthorizationService>;
	let aiClientService: DeepMocked<AiClientService>;

	const configuredConfig = (): AiConfig =>
		({
			featureAiEnabled: true,
			aiClientApiKey: 'test-key',
			aiClientBaseUrl: 'https://ai.example.com',
			aiClientModel: 'test-model',
			isConfigured: () => true,
		}) as AiConfig;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				AiQuestionUc,
				{
					provide: AI_CONFIG_TOKEN,
					useValue: configuredConfig(),
				},
				{
					provide: AuthorizationService,
					useValue: createMock<AuthorizationService>(),
				},
				{
					provide: BoardNodeAuthorizableService,
					useValue: createMock<BoardNodeAuthorizableService>(),
				},
				{
					provide: BoardNodeService,
					useValue: createMock<BoardNodeService>(),
				},
				{
					provide: BoardNodeFactory,
					useValue: createMock<BoardNodeFactory>(),
				},
				{
					provide: BoardNodeRule,
					useValue: createMock<BoardNodeRule>(),
				},
				{
					provide: AiClientService,
					useValue: createMock<AiClientService>(),
				},
				{
					provide: Logger,
					useValue: createMock<Logger>(),
				},
			],
		}).compile();

		uc = module.get(AiQuestionUc);
		boardNodeService = module.get(BoardNodeService);
		boardNodeAuthorizableService = module.get(BoardNodeAuthorizableService);
		boardNodeRule = module.get(BoardNodeRule);
		boardNodeFactory = module.get(BoardNodeFactory);
		authorizationService = module.get(AuthorizationService);
		aiClientService = module.get(AiClientService);
	});

	beforeEach(() => {
		jest.clearAllMocks();
		boardNodeRule.can.mockReturnValue(true);
		aiClientService.complete.mockResolvedValue('Teilweise richtig: ...');
	});

	type ElementProps = Parameters<typeof aiQuestionElementFactory.build>[0];

	const setupElement = (props: ElementProps = {}): AiQuestionElement => aiQuestionElementFactory.build(props);

	const setupUserContext = (
		element: AiQuestionElement,
		users: { userId: string; firstName?: string; lastName?: string; roles: unknown }[] = []
	) => {
		const user = userFactory.buildWithId();
		authorizationService.getUserWithPermissions.mockResolvedValue(user as never);
		boardNodeService.findByClassAndId.mockResolvedValue(element as never);
		const authorizable = boardNodeAuthorizableFactory.build({ users: users as never });
		boardNodeAuthorizableService.getBoardAuthorizable.mockResolvedValue(authorizable);

		return user;
	};

	describe('getConfig', () => {
		it('should return the private config to a manager', async () => {
			const element = setupElement({
				question: 'Was ist 2+2?',
				aiInstructions: 'Streng sein',
				expectedAnswer: '4',
				allowMultipleAttempts: true,
			});
			setupUserContext(element);

			const result = await uc.getConfig('userId', element.id);

			expect(result.question).toBe('Was ist 2+2?');
			expect(result.aiInstructions).toBe('Streng sein');
			expect(result.expectedAnswer).toBe('4');
			expect(result.allowMultipleAttempts).toBe(true);
		});

		it('should throw a forbidden error for a non-manager', async () => {
			const element = setupElement();
			setupUserContext(element);
			boardNodeRule.can.mockReturnValue(false);

			await expect(uc.getConfig('userId', element.id)).rejects.toThrow(ForbiddenException);
		});
	});

	describe('submitAnswer', () => {
		it('should create an answer with the AI response and attempt count 1', async () => {
			const element = setupElement({
				question: 'Was ist 2+2?',
				aiInstructions: 'Streng sein',
				expectedAnswer: '4',
			});
			setupUserContext(element);
			const answer = aiQuestionAnswerFactory.build();
			boardNodeFactory.buildAiQuestionAnswer.mockReturnValue(answer);
			boardNodeService.addToParent.mockResolvedValue();

			const result = await uc.submitAnswer('userId', element.id, 'meine Antwort');

			expect(aiClientService.complete).toHaveBeenCalledWith(
				expect.stringContaining('prüfender Assistent'),
				expect.stringContaining('Was ist 2+2?')
			);
			expect(aiClientService.complete).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining('Erwartete Antwort')
			);
			expect(result.answer).toBe('meine Antwort');
			expect(result.aiResponse).toBe('Teilweise richtig: ...');
			expect(result.attemptCount).toBe(1);
			expect(result.answeredAt).toBeInstanceOf(Date);
			expect(boardNodeService.addToParent).toHaveBeenCalledWith(element, answer);
			expect(boardNodeService.save).not.toHaveBeenCalled();
		});

		it('should reject a second attempt when the element allows only one', async () => {
			const element = setupElement({ allowMultipleAttempts: false });
			const existing = aiQuestionAnswerFactory.build({ userId: 'userId' });
			element.addChild(existing);
			setupUserContext(element);

			await expect(uc.submitAnswer('userId', element.id, 'zweiter Versuch')).rejects.toThrow(
				'This question has already been answered.'
			);
			expect(aiClientService.complete).not.toHaveBeenCalled();
		});

		it('should replace the answer and increase the attempt count when re-answering is allowed', async () => {
			const element = setupElement({ allowMultipleAttempts: true });
			const existing = aiQuestionAnswerFactory.build({ userId: 'userId', attemptCount: 1 });
			element.addChild(existing);
			setupUserContext(element);

			const result = await uc.submitAnswer('userId', element.id, 'zweiter Versuch');

			expect(result.answer).toBe('zweiter Versuch');
			expect(result.attemptCount).toBe(2);
			expect(boardNodeService.save).toHaveBeenCalledWith(existing);
			expect(boardNodeService.addToParent).not.toHaveBeenCalled();
		});

		it('should persist nothing when the AI call fails', async () => {
			const element = setupElement();
			setupUserContext(element);
			aiClientService.complete.mockRejectedValue(new ServiceUnavailableException());

			await expect(uc.submitAnswer('userId', element.id, 'Antwort')).rejects.toThrow(ServiceUnavailableException);
			expect(boardNodeService.addToParent).not.toHaveBeenCalled();
			expect(boardNodeService.save).not.toHaveBeenCalled();
		});

		it('should throw a forbidden error when the rule denies creating an answer', async () => {
			const element = setupElement();
			setupUserContext(element);
			boardNodeRule.can.mockReturnValue(false);

			await expect(uc.submitAnswer('userId', element.id, 'Antwort')).rejects.toThrow(ForbiddenException);
		});
	});

	describe('getOwnAnswer', () => {
		it('should return the own answer for its owner', async () => {
			const element = setupElement();
			const existing = aiQuestionAnswerFactory.build({ userId: 'userId', answer: 'Antwort' });
			element.addChild(existing);
			setupUserContext(element);

			const result = await uc.getOwnAnswer('userId', element.id);

			expect(result.answer?.id).toBe(existing.id);
			expect(result.answer?.answer).toBe('Antwort');
		});

		it('should return null when the user has not answered yet', async () => {
			const element = setupElement();
			setupUserContext(element);

			const result = await uc.getOwnAnswer('userId', element.id);

			expect(result.answer).toBeNull();
		});
	});

	describe('listAnswers', () => {
		it('should return all answers with the names of the authors', async () => {
			const element = setupElement();
			setupUserContext(element, [
				{ userId: 'user-1', firstName: 'Anna', lastName: 'Admin', roles: [] },
				{ userId: 'user-2', firstName: 'Ben', lastName: 'Bauer', roles: [] },
			]);
			const answerOne = aiQuestionAnswerFactory.build({ userId: 'user-1', answer: 'erste Antwort' });
			const answerTwo = aiQuestionAnswerFactory.build({ userId: 'user-2', answer: 'zweite Antwort' });
			element.addChild(answerOne);
			element.addChild(answerTwo);

			const result = await uc.listAnswers('teacherId', element.id);

			expect(result.answers).toHaveLength(2);
			expect(result.answers[0]).toMatchObject({ firstName: 'Anna', lastName: 'Admin' });
			expect(result.answers[1]).toMatchObject({ firstName: 'Ben', lastName: 'Bauer' });
		});
	});

	describe('checkFeatureEnabled', () => {
		it('should throw a not-found error when the flag is off', async () => {
			const module = await Test.createTestingModule({
				providers: [
					AiQuestionUc,
					{
						provide: AI_CONFIG_TOKEN,
						useValue: { ...configuredConfig(), featureAiEnabled: false, isConfigured: () => false },
					},
					{
						provide: AuthorizationService,
						useValue: createMock<AuthorizationService>(),
					},
					{
						provide: BoardNodeAuthorizableService,
						useValue: createMock<BoardNodeAuthorizableService>(),
					},
					{
						provide: BoardNodeService,
						useValue: createMock<BoardNodeService>(),
					},
					{
						provide: BoardNodeFactory,
						useValue: createMock<BoardNodeFactory>(),
					},
					{
						provide: BoardNodeRule,
						useValue: createMock<BoardNodeRule>(),
					},
					{
						provide: AiClientService,
						useValue: createMock<AiClientService>(),
					},
					{
						provide: Logger,
						useValue: createMock<Logger>(),
					},
				],
			}).compile();

			const disabledUc = module.get(AiQuestionUc);

			await expect(disabledUc.getConfig('userId', 'elementId')).rejects.toThrow(NotFoundException);
		});

		it('should treat flag-without-key as disabled', async () => {
			const module = await Test.createTestingModule({
				providers: [
					AiQuestionUc,
					{
						provide: AI_CONFIG_TOKEN,
						useValue: { ...configuredConfig(), aiClientApiKey: '', isConfigured: () => false },
					},
					{
						provide: AuthorizationService,
						useValue: createMock<AuthorizationService>(),
					},
					{
						provide: BoardNodeAuthorizableService,
						useValue: createMock<BoardNodeAuthorizableService>(),
					},
					{
						provide: BoardNodeService,
						useValue: createMock<BoardNodeService>(),
					},
					{
						provide: BoardNodeFactory,
						useValue: createMock<BoardNodeFactory>(),
					},
					{
						provide: BoardNodeRule,
						useValue: createMock<BoardNodeRule>(),
					},
					{
						provide: AiClientService,
						useValue: createMock<AiClientService>(),
					},
					{
						provide: Logger,
						useValue: createMock<Logger>(),
					},
				],
			}).compile();

			const unconfiguredUc = module.get(AiQuestionUc);

			await expect(unconfiguredUc.submitAnswer('userId', 'elementId', 'Antwort')).rejects.toThrow(NotFoundException);
		});
	});
});
