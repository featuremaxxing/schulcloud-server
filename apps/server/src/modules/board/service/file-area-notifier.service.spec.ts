import { LegacyLogger } from '@infra/logger';
import { EntityManager } from '@mikro-orm/mongodb';
import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { Test, type TestingModule } from '@nestjs/testing';
import { Emitter } from '@socket.io/mongo-emitter';
import { FILE_AREA_CHANGED_EVENT, FileAreaNotifier } from './file-area-notifier.service';

jest.mock('@socket.io/mongo-emitter');

describe(FileAreaNotifier.name, () => {
	let module: TestingModule;
	let notifier: FileAreaNotifier;
	let logger: DeepMocked<LegacyLogger>;
	const emit = jest.fn();
	const to = jest.fn().mockReturnValue({ emit });

	beforeAll(async () => {
		module = await Test.createTestingModule({
			providers: [
				FileAreaNotifier,
				{ provide: EntityManager, useValue: createMock<EntityManager>() },
				{ provide: LegacyLogger, useValue: createMock<LegacyLogger>() },
			],
		}).compile();

		notifier = module.get(FileAreaNotifier);
		logger = module.get(LegacyLogger);
	});

	afterAll(async () => {
		await module.close();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		to.mockReturnValue({ emit });
		jest.mocked(Emitter).mockImplementation(() => ({ to }) as unknown as Emitter);
	});

	it('should emit the changed folders into the room of the board', () => {
		notifier.foldersChanged('board1', ['a', 'b', 'a']);

		expect(to).toHaveBeenCalledWith('board_board1');
		expect(emit).toHaveBeenCalledWith(FILE_AREA_CHANGED_EVENT, {
			boardId: 'board1',
			parentIds: ['a', 'b'],
			kind: 'folders',
		});
	});

	it('should emit changed files', () => {
		notifier.filesChanged('board1', ['a']);

		expect(emit).toHaveBeenCalledWith(FILE_AREA_CHANGED_EVENT, { boardId: 'board1', parentIds: ['a'], kind: 'files' });
	});

	it('should not throw when emitting fails', () => {
		emit.mockImplementationOnce(() => {
			throw new Error('mongo down');
		});

		expect(() => notifier.filesChanged('board1', ['a'])).not.toThrow();
		expect(logger.warn).toHaveBeenCalled();
	});
});
