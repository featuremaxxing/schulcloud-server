import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { setupEntities } from '@testing/database';
import bcrypt from 'bcryptjs';
import { AppPasswordEntity, AppPasswordRepo } from '../repo';
import { appPasswordEntityFactory } from '../testing';
import { AppPasswordService } from './app-password.service';

describe(AppPasswordService.name, () => {
	let module: TestingModule;
	let service: AppPasswordService;
	let repo: DeepMocked<AppPasswordRepo>;

	beforeAll(async () => {
		await setupEntities([AppPasswordEntity]);

		module = await Test.createTestingModule({
			providers: [AppPasswordService, { provide: AppPasswordRepo, useValue: createMock<AppPasswordRepo>() }],
		}).compile();

		service = module.get(AppPasswordService);
		repo = module.get(AppPasswordRepo);
	});

	afterAll(async () => {
		await module.close();
	});

	afterEach(() => {
		jest.resetAllMocks();
	});

	const createStored = async (secret: string, props: Partial<AppPasswordEntity> = {}): Promise<AppPasswordEntity> =>
		appPasswordEntityFactory.buildWithId({ secretHash: await bcrypt.hash(secret, 4), ...props });

	describe('create', () => {
		it('should store only a hash and return a token of id and secret', async () => {
			const userId = new ObjectId().toHexString();
			repo.countByUserId.mockResolvedValueOnce(0);
			repo.create.mockImplementationOnce((props) =>
				Promise.resolve(appPasswordEntityFactory.buildWithId({ ...props }))
			);

			const { appPassword, token } = await service.create(userId, '  Laptop  ');

			const [id, secret] = token.split('.');
			expect(id).toEqual(appPassword.id);
			expect(secret.length).toBeGreaterThanOrEqual(32);
			expect(repo.create).toHaveBeenCalledWith({ userId, name: 'Laptop', secretHash: expect.any(String) });
			const { secretHash } = repo.create.mock.calls[0][0];
			expect(secretHash).not.toContain(secret);
			await expect(bcrypt.compare(secret, secretHash)).resolves.toBe(true);
		});

		it('should refuse more than 20 app passwords per user', async () => {
			repo.countByUserId.mockResolvedValueOnce(20);

			await expect(service.create(new ObjectId().toHexString(), 'x')).rejects.toThrow(BadRequestException);
			expect(repo.create).not.toHaveBeenCalled();
		});
	});

	describe('verify', () => {
		it('should return the owner for a valid token and cache the result', async () => {
			const stored = await createStored('s3cret-valid');
			repo.findById.mockResolvedValue(stored);

			const token = `${stored.id}.s3cret-valid`;
			const first = await service.verify(token);
			const second = await service.verify(token);

			expect(first).toEqual({ appPasswordId: stored.id, userId: stored.userId });
			expect(second).toEqual(first);
			expect(repo.findById).toHaveBeenCalledTimes(1);
			expect(repo.updateLastUsedAt).toHaveBeenCalledWith(stored.id, expect.any(Date));
		});

		it('should reject a wrong secret', async () => {
			const stored = await createStored('right-secret');
			repo.findById.mockResolvedValue(stored);

			await expect(service.verify(`${stored.id}.wrong-secret`)).resolves.toBeNull();
		});

		it('should reject unknown ids and malformed tokens', async () => {
			repo.findById.mockResolvedValue(null);

			await expect(service.verify(`${new ObjectId().toHexString()}.x`)).resolves.toBeNull();
			await expect(service.verify('no-separator')).resolves.toBeNull();
		});

		it('should not update lastUsedAt on every verification', async () => {
			const stored = await createStored('recently-used', { lastUsedAt: new Date() });
			repo.findById.mockResolvedValue(stored);

			await service.verify(`${stored.id}.recently-used`);

			expect(repo.updateLastUsedAt).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('should delete an own app password and stop accepting it immediately', async () => {
			const stored = await createStored('to-be-revoked');
			repo.findById.mockResolvedValue(stored);
			const token = `${stored.id}.to-be-revoked`;
			await expect(service.verify(token)).resolves.not.toBeNull();

			await service.delete(stored.userId, stored.id);
			repo.findById.mockResolvedValue(null);

			expect(repo.delete).toHaveBeenCalledWith(stored);
			await expect(service.verify(token)).resolves.toBeNull();
		});

		it('should not delete an app password of another user', async () => {
			const stored = await createStored('foreign');
			repo.findById.mockResolvedValue(stored);

			await expect(service.delete(new ObjectId().toHexString(), stored.id)).rejects.toThrow(NotFoundException);
			expect(repo.delete).not.toHaveBeenCalled();
		});
	});
});
