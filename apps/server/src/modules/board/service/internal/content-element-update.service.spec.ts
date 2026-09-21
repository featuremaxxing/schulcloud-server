import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { Test, type TestingModule } from '@nestjs/testing';
import { InputFormat } from '@shared/domain/types';
import {
	DrawingContentBody,
	ExternalToolContentBody,
	FileContentBody,
	FileFolderContentBody,
	H5pContentBody,
	LinkContentBody,
	PollContentBody,
	RichTextContentBody,
	VideoConferenceContentBody,
} from '../../controller/dto';
import {
	BoardRoles,
	PollAnswerMode,
	PollAudience,
	PollChartType,
	PollStatus,
	type UserWithBoardRoles,
} from '../../domain';
import { BoardNodeRepo } from '../../repo';
import {
	drawingElementFactory,
	externalToolElementFactory,
	fileElementFactory,
	fileFolderElementFactory,
	h5pElementFactory,
	linkElementFactory,
	pollElementFactory,
	pollVoteFactory,
	richTextElementFactory,
	videoConferenceElementFactory,
} from '../../testing';
import { ContentElementUpdateService } from './content-element-update.service';

describe('ContentElementUpdateService', () => {
	let module: TestingModule;
	let service: ContentElementUpdateService;
	let repo: DeepMocked<BoardNodeRepo>;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				ContentElementUpdateService,
				{
					provide: BoardNodeRepo,
					useValue: createMock<BoardNodeRepo>(),
				},
			],
		}).compile();

		service = module.get(ContentElementUpdateService);
		repo = module.get(BoardNodeRepo);
	});

	afterAll(async () => {
		await module.close();
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('when the element is a FileElement', () => {
		const setup = () => {
			const element = fileElementFactory.build();
			const content = new FileContentBody();
			content.caption = 'caption';
			content.alternativeText = 'alternativeText';

			return {
				element,
				content,
			};
		};

		it('should update FileElement', async () => {
			const { element, content } = setup();

			await service.updateContent(element, content);

			expect(element.caption).toBe('caption');
			expect(element.alternativeText).toBe('alternativeText');
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a FileFolderElement', () => {
		const setup = () => {
			const element = fileFolderElementFactory.build();
			const content = new FileFolderContentBody();
			content.title = 'title';

			return {
				element,
				content,
			};
		};

		it('should update FileFolderElement', async () => {
			const { element, content } = setup();

			await service.updateContent(element, content);

			expect(element.title).toBe('title');
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a LinkElement', () => {
		const setup = () => {
			const element = linkElementFactory.build();
			const content = new LinkContentBody();
			content.url = 'http://example.com/';
			content.title = 'title';
			content.description = 'description';
			content.imageUrl = 'relative-image.jpg';

			return {
				element,
				content,
			};
		};

		it('should update LinkElement', async () => {
			const { element, content } = setup();

			await service.updateContent(element, content);

			expect(element.url).toBe('http://example.com/');
			expect(element.title).toBe('title');
			expect(element.description).toBe('description');
			expect(element.imageUrl).toBe('relative-image.jpg');
			expect(repo.save).toHaveBeenCalledWith(element);
		});

		describe('when content has an imageUrl that is an empty string', () => {
			it('should set element imageUrl to an empty string', async () => {
				const element = linkElementFactory.build();
				const content = new LinkContentBody();
				content.url = 'http://example.com/';
				content.title = 'title';
				content.description = 'description';
				content.imageUrl = '';

				await service.updateContent(element, content);

				expect(element.imageUrl).toBe('');
				expect(repo.save).toHaveBeenCalledWith(element);
			});
		});
	});

	describe('when the element is a RichTextElement', () => {
		const setup = () => {
			const element = richTextElementFactory.build();
			const content = new RichTextContentBody();
			content.text = 'text';
			content.inputFormat = InputFormat.PLAIN_TEXT;

			return {
				element,
				content,
			};
		};

		it('should update RichTextElement', async () => {
			const { element, content } = setup();

			await service.updateContent(element, content);

			expect(element.text).toBe('text');
			expect(element.inputFormat).toBe(InputFormat.PLAIN_TEXT);
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a DrawingElement', () => {
		const setup = () => {
			const element = drawingElementFactory.build();
			const content = new DrawingContentBody();
			content.description = 'description';

			return {
				element,
				content,
			};
		};

		it('should update DrawingElement', async () => {
			const { element, content } = setup();

			await service.updateContent(element, content);

			expect(element.description).toBe('description');
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a ExternalToolElement', () => {
		const setup = () => {
			const element = externalToolElementFactory.build({
				contextExternalToolId: undefined,
			});
			const content = new ExternalToolContentBody();
			const contextExternalToolId = new ObjectId().toHexString();
			content.contextExternalToolId = contextExternalToolId;

			return {
				element,
				content,
				contextExternalToolId,
			};
		};

		it('should update ExternalToolElement', async () => {
			const { element, content, contextExternalToolId } = setup();

			await service.updateContent(element, content);

			expect(element.contextExternalToolId).toBe(contextExternalToolId);
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a VideoConferenceElement', () => {
		const setup = () => {
			const element = videoConferenceElementFactory.build();
			const content = new VideoConferenceContentBody();
			content.title = 'vc title';

			return {
				element,
				content,
			};
		};

		it('should update VideoConferenceElement', async () => {
			const { element, content } = setup();

			await service.updateContent(element, content);

			expect(element.title).toBe('vc title');
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a H5pElement', () => {
		const setup = () => {
			const element = h5pElementFactory.build();
			const content = new H5pContentBody();
			const contentId = new ObjectId().toHexString();
			content.contentId = contentId;

			return {
				element,
				content,
				contentId,
			};
		};

		it('should update H5pElement', async () => {
			const { element, content, contentId } = setup();

			await service.updateContent(element, content);

			expect(element.contentId).toBe(contentId);
			expect(repo.save).toHaveBeenCalledWith(element);
		});
	});

	describe('when the element is a PollElement', () => {
		const buildContent = (overrides: Partial<PollContentBody> = {}): PollContentBody => {
			const content = new PollContentBody();
			content.title = 'title';
			content.questions = [
				{
					id: new ObjectId().toHexString(),
					text: 'question',
					answerMode: PollAnswerMode.SINGLE,
					chartType: PollChartType.BAR,
					options: [
						{ id: new ObjectId().toHexString(), text: 'a' },
						{ id: new ObjectId().toHexString(), text: 'b' },
					],
				},
			];
			content.isAnonymous = false;
			content.showResultsLive = false;
			content.pollStatus = PollStatus.OPEN;
			Object.assign(content, overrides);

			return content;
		};

		it('should update the poll element', async () => {
			const element = pollElementFactory.build();
			const content = buildContent({ title: 'new title' });

			await service.updateContent(element, content);

			expect(element.title).toBe('new title');
			expect(element.questions).toHaveLength(1);
			expect(repo.save).toHaveBeenCalledWith(element);
		});

		it('should freeze a result snapshot when the poll transitions to CLOSED', async () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.OPEN });
			const content = buildContent({ pollStatus: PollStatus.CLOSED });

			await service.updateContent(element, content);

			expect(element.resultSnapshot).toBeDefined();
		});

		it('should not touch an existing result snapshot while the poll stays CLOSED', async () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.CLOSED });
			const existingSnapshot = { frozenAt: new Date(), participantCount: 3, perQuestion: [] };
			element.resultSnapshot = existingSnapshot;
			const content = buildContent({ pollStatus: PollStatus.CLOSED });

			await service.updateContent(element, content);

			expect(element.resultSnapshot).toBe(existingSnapshot);
		});

		it('should clear a leftover result snapshot when a closed poll is reopened', async () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.CLOSED });
			element.resultSnapshot = { frozenAt: new Date(), participantCount: 3, perQuestion: [] };
			const content = buildContent({ pollStatus: PollStatus.OPEN });

			await service.updateContent(element, content);

			expect(element.resultSnapshot).toBeUndefined();
		});

		it('should clear a leftover result snapshot when a closed poll is set back to DRAFT', async () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.CLOSED });
			element.resultSnapshot = { frozenAt: new Date(), participantCount: 3, perQuestion: [] };
			const content = buildContent({ pollStatus: PollStatus.DRAFT });

			await service.updateContent(element, content);

			expect(element.resultSnapshot).toBeUndefined();
		});

		it('should not set a result snapshot for a poll that was never closed', async () => {
			const element = pollElementFactory.build({ pollStatus: PollStatus.DRAFT });
			const content = buildContent({ pollStatus: PollStatus.OPEN });

			await service.updateContent(element, content);

			expect(element.resultSnapshot).toBeUndefined();
		});

		it('should update the audience', async () => {
			const element = pollElementFactory.build({ audience: PollAudience.STUDENTS });
			const content = buildContent({ audience: PollAudience.TEACHERS });

			await service.updateContent(element, content);

			expect(element.audience).toBe(PollAudience.TEACHERS);
		});

		it('should keep audienceRoles only when audience is CUSTOM', async () => {
			const element = pollElementFactory.build();
			const content = buildContent({ audience: PollAudience.ALL, audienceRoles: [BoardRoles.READER] });

			await service.updateContent(element, content);

			expect(element.audienceRoles).toBeUndefined();
		});

		it('should freeze the number of eligible voters, not the number of votes cast, into the snapshot', async () => {
			// U-R3/U1: closing a poll where not everyone eligible has voted must not report
			// "n of n" - the frozen participantCount is the eligible-voter count, independent
			// of how many PollVote children actually exist.
			const vote = pollVoteFactory.build();
			const element = pollElementFactory.build({
				pollStatus: PollStatus.OPEN,
				audience: PollAudience.STUDENTS,
				children: [vote],
			});
			const content = buildContent({ pollStatus: PollStatus.CLOSED });
			const users: UserWithBoardRoles[] = [
				{ userId: 'student-1', roles: [BoardRoles.READER] },
				{ userId: 'student-2', roles: [BoardRoles.READER] },
				{ userId: 'teacher-1', roles: [BoardRoles.EDITOR] },
			];

			await service.updateContent(element, content, users);

			expect(element.resultSnapshot?.participantCount).toBe(2);
		});

		it('should reject changing the audience once votes have been cast', async () => {
			const vote = pollVoteFactory.build();
			const element = pollElementFactory.build({ audience: PollAudience.STUDENTS, children: [vote] });
			const content = buildContent({ audience: PollAudience.TEACHERS });

			await expect(service.updateContent(element, content)).rejects.toThrow();
		});

		it('should allow keeping the same audience once votes have been cast', async () => {
			const vote = pollVoteFactory.build();
			const element = pollElementFactory.build({ audience: PollAudience.STUDENTS, children: [vote] });
			const content = buildContent({ audience: PollAudience.STUDENTS, title: 'updated title' });

			await service.updateContent(element, content);

			expect(element.title).toBe('updated title');
		});

		it('should allow changing the audience before any vote has been cast', async () => {
			const element = pollElementFactory.build({ audience: PollAudience.STUDENTS, children: [] });
			const content = buildContent({ audience: PollAudience.TEACHERS });

			await service.updateContent(element, content);

			expect(element.audience).toBe(PollAudience.TEACHERS);
		});
	});

	describe('when the element is unkown', () => {
		it('should throw error for unknown element type', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-argument
			await expect(service.updateContent({} as any, {} as any)).rejects.toThrow(
				"Cannot update element of type: 'Object'"
			);
		});
	});
});
