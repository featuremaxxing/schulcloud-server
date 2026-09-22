import { type CopyFileDomainObjectProps, type FileDomainObjectProps, FileRecordParentType } from '../interfaces';
import { FilesStorageClientMapper } from './files-storage-client.mapper';

describe('FilesStorageClientMapper', () => {
	describe('fileDto mapper', () => {
		const record = {
			id: 'id123',
			name: 'name',
			parentId: 'parent123',
			creatorId: 'creator123',
			size: 123,
			type: 'png',
			securityCheckStatus: 'pending',
			parentType: FileRecordParentType.Task,
		};

		const response: FileDomainObjectProps[] = [record];

		describe('mapfileRecordListResponseToDomainFilesDto', () => {
			it('Should map to valid file Dtos.', () => {
				const result = FilesStorageClientMapper.mapfileRecordListResponseToDomainFilesDto(response);

				expect(result).toEqual(
					expect.arrayContaining([
						{
							id: record.id,
							name: record.name,
							parentId: record.parentId,
							parentType: record.parentType,
						},
					])
				);
			});
		});

		describe('mapFileRecordResponseToFileDto', () => {
			it('Should map to valid file Dto.', () => {
				const result = FilesStorageClientMapper.mapFileRecordResponseToFileDto(record);

				expect(result).toEqual(
					expect.objectContaining({
						id: record.id,
						name: record.name,
						parentId: record.parentId,
						parentType: record.parentType,
					})
				);
			});

			it.todo('Should use FileStorageClientMapper.mapStringToPartenType for map parentTypes');

			// The AMQP payload is JSON, so the timestamps really arrive as strings here although
			// the interface types them as Date - consumers call Date methods on them.
			it('Should revive timestamps that arrive as ISO strings', () => {
				const result = FilesStorageClientMapper.mapFileRecordResponseToFileDto({
					...record,
					createdAt: '2026-09-20T10:39:03.945Z' as unknown as Date,
					updatedAt: '2026-09-21T11:00:00.000Z' as unknown as Date,
				});

				expect(result.createdAt).toEqual(new Date('2026-09-20T10:39:03.945Z'));
				expect(result.updatedAt).toEqual(new Date('2026-09-21T11:00:00.000Z'));
			});

			it('Should keep timestamps that already are dates', () => {
				const createdAt = new Date('2026-09-20T10:39:03.945Z');

				const result = FilesStorageClientMapper.mapFileRecordResponseToFileDto({ ...record, createdAt });

				expect(result.createdAt).toStrictEqual(createdAt);
			});

			it('Should map an unparsable timestamp to undefined', () => {
				const result = FilesStorageClientMapper.mapFileRecordResponseToFileDto({
					...record,
					createdAt: 'not a date' as unknown as Date,
				});

				expect(result.createdAt).toBeUndefined();
			});

			it('Should leave a missing timestamp undefined', () => {
				const result = FilesStorageClientMapper.mapFileRecordResponseToFileDto(record);

				expect(result.createdAt).toBeUndefined();
				expect(result.updatedAt).toBeUndefined();
			});
		});

		describe('mapStringToPartenType', () => {
			it('Should map "users".', () => {
				const result = FilesStorageClientMapper.mapStringToParentType('users');

				expect(result).toStrictEqual('users');
			});

			it('Should map "courses".', () => {
				const result = FilesStorageClientMapper.mapStringToParentType('courses');

				expect(result).toStrictEqual('courses');
			});

			it('Should map "schools".', () => {
				const result = FilesStorageClientMapper.mapStringToParentType('schools');

				expect(result).toStrictEqual('schools');
			});

			it('Should map "tasks".', () => {
				const result = FilesStorageClientMapper.mapStringToParentType('tasks');

				expect(result).toStrictEqual('tasks');
			});

			it('Should throw for not supported mappings', () => {
				expect(() => FilesStorageClientMapper.mapStringToParentType('abc')).toThrow();
			});
		});
	});

	describe('copyFileDto mapper', () => {
		const copyFileResponse: CopyFileDomainObjectProps = {
			id: 'id123',
			sourceId: 'sourceId123',
			name: 'name',
		};

		const list: CopyFileDomainObjectProps[] = [copyFileResponse];

		describe('mapCopyFileListResponseToCopyFilesDto', () => {
			it('Should map to valid file Dtos.', () => {
				const result = FilesStorageClientMapper.mapCopyFileListResponseToCopyFilesDto(list);

				expect(result).toEqual(
					expect.arrayContaining([
						{
							...copyFileResponse,
						},
					])
				);
			});
		});

		describe('mapCopyFileResponseToCopyFileDto', () => {
			it('Should map to valid file Dto.', () => {
				const result = FilesStorageClientMapper.mapCopyFileResponseToCopyFileDto(copyFileResponse);

				expect(result).toEqual(
					expect.objectContaining({
						...copyFileResponse,
					})
				);
			});

			it.todo('Should use FileStorageClientMapper.mapStringToPartenType for map parentTypes');
		});
	});
});
