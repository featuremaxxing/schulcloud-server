import { ObjectId } from '@mikro-orm/mongodb';
import { Readable } from 'node:stream';
import { type WebDavDownload, type WebDavFileRecord } from '../webdav-files-storage.client';

// In-memory stand-in for the file storage service, keyed by parent (element) id.
export class FakeFilesStorage {
	public readonly files = new Map<string, { record: WebDavFileRecord; content: Buffer }>();

	public list(_jwt: string, _schoolId: string, parentId: string): Promise<WebDavFileRecord[]> {
		return Promise.resolve(
			[...this.files.values()].filter((file) => file.record.parentId === parentId).map((file) => file.record)
		);
	}

	public download(_jwt: string, fileRecord: WebDavFileRecord): Promise<WebDavDownload> {
		const file = this.files.get(fileRecord.id);
		if (!file) throw new Error('not found');

		return Promise.resolve({
			status: 200,
			headers: { 'content-type': file.record.mimeType, 'content-length': String(file.content.length) },
			stream: Readable.from(file.content),
		});
	}

	public async upload(
		_jwt: string,
		_schoolId: string,
		parentId: string,
		fileName: string,
		content: Readable
	): Promise<WebDavFileRecord> {
		const chunks: Buffer[] = [];
		for await (const chunk of content) {
			chunks.push(Buffer.from(chunk as Buffer));
		}
		// like the real file storage: a duplicate name in the same parent gets renamed
		const taken = [...this.files.values()].some((f) => f.record.parentId === parentId && f.record.name === fileName);
		const name = taken ? fileName.replace(/(\.[^.]*)?$/, ' (1)$1') : fileName;
		const record: WebDavFileRecord = {
			id: new ObjectId().toHexString(),
			name,
			size: Buffer.concat(chunks).length,
			mimeType: 'text/plain',
			parentId,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		this.files.set(record.id, { record, content: Buffer.concat(chunks) });

		return record;
	}

	public rename(_jwt: string, fileRecordId: string, fileName: string): Promise<WebDavFileRecord> {
		const file = this.files.get(fileRecordId);
		if (!file) throw new Error('not found');
		file.record = { ...file.record, name: fileName };

		return Promise.resolve(file.record);
	}

	public delete(_jwt: string, fileRecordId: string): Promise<void> {
		this.files.delete(fileRecordId);

		return Promise.resolve();
	}
}
