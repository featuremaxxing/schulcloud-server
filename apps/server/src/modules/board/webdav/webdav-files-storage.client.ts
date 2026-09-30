import { HttpService } from '@nestjs/axios';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { AxiosError, AxiosResponse, RawAxiosRequestHeaders } from 'axios';
import FormData from 'form-data';
import { Readable } from 'node:stream';
import { lastValueFrom } from 'rxjs';
import { WEBDAV_CONFIG_TOKEN, WebDavConfig } from './webdav.config';
import { WebDavError } from './webdav.error';

export interface WebDavFileRecord {
	id: EntityId;
	name: string;
	size: number;
	mimeType: string;
	parentId: EntityId;
	createdAt: Date;
	updatedAt: Date;
}

interface FileRecordResponse {
	id: string;
	name: string;
	size: number;
	mimeType: string;
	parentId: string;
	isUploading?: boolean;
	createdAt: string;
	updatedAt: string;
}

interface FileRecordListResponse {
	data: FileRecordResponse[];
	total: number;
}

export interface WebDavDownload {
	status: number;
	headers: Record<string, string>;
	stream: Readable;
}

const STORAGE_LOCATION = 'school';
const PARENT_TYPE = 'boardnodes';
const PAGE_SIZE = 100;
// errors the client can make sense of; everything else is a gateway problem
const PASSED_THROUGH_ERROR_STATUSES: number[] = [
	HttpStatus.FORBIDDEN,
	HttpStatus.NOT_FOUND,
	HttpStatus.CONFLICT,
	HttpStatus.PAYLOAD_TOO_LARGE,
	HttpStatus.UNSUPPORTED_MEDIA_TYPE,
	HttpStatus.UNPROCESSABLE_ENTITY,
];
const PASSED_THROUGH_DOWNLOAD_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag'];

/**
 * Talks to the file storage service with a JWT minted for the WebDAV user, so the file
 * storage runs its usual permission checks (via the server's authorization reference API)
 * on top of the board checks done here.
 */
@Injectable()
export class WebDavFilesStorageClient {
	constructor(
		private readonly httpService: HttpService,
		@Inject(WEBDAV_CONFIG_TOKEN) private readonly config: WebDavConfig
	) {}

	public async list(jwt: string, schoolId: EntityId, parentId: EntityId): Promise<WebDavFileRecord[]> {
		const fileRecords: FileRecordResponse[] = [];
		let total = Infinity;

		while (fileRecords.length < total) {
			const url = this.url(`/file/list/${STORAGE_LOCATION}/${schoolId}/${PARENT_TYPE}/${parentId}`);

			const response = await this.request<FileRecordListResponse>(() =>
				this.httpService.get<FileRecordListResponse>(url, {
					headers: this.authHeaders(jwt),
					params: { skip: fileRecords.length, limit: PAGE_SIZE },
				})
			);
			fileRecords.push(...response.data.data);
			total = response.data.data.length === 0 ? fileRecords.length : response.data.total;
		}

		return fileRecords
			.filter((fileRecord) => !fileRecord.isUploading)
			.map((fileRecord) => WebDavFilesStorageClient.mapFileRecord(fileRecord));
	}

	public async download(jwt: string, fileRecord: WebDavFileRecord, range?: string): Promise<WebDavDownload> {
		const url = this.url(`/file/download/${fileRecord.id}/${encodeURIComponent(fileRecord.name)}`);
		const headers: RawAxiosRequestHeaders = this.authHeaders(jwt);
		if (range) {
			headers.Range = range;
		}

		const response = await this.request<Readable>(() =>
			this.httpService.get<Readable>(url, { headers, responseType: 'stream' })
		);

		const passedHeaders: Record<string, string> = {};
		PASSED_THROUGH_DOWNLOAD_HEADERS.forEach((name) => {
			const value: unknown = response.headers[name];
			if (typeof value === 'string' || typeof value === 'number') {
				passedHeaders[name] = String(value);
			}
		});

		return { status: response.status, headers: passedHeaders, stream: response.data };
	}

	public async upload(
		jwt: string,
		schoolId: EntityId,
		parentId: EntityId,
		fileName: string,
		content: Readable,
		contentLength?: number
	): Promise<WebDavFileRecord> {
		const formData = new FormData();
		formData.append('file', content, { filename: fileName, knownLength: contentLength });

		const url = this.url(`/file/upload/${STORAGE_LOCATION}/${schoolId}/${PARENT_TYPE}/${parentId}`);
		const response = await this.request<FileRecordResponse>(() =>
			this.httpService.post<FileRecordResponse>(url, formData, {
				headers: { ...formData.getHeaders(), ...this.authHeaders(jwt) },
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			})
		);

		return WebDavFilesStorageClient.mapFileRecord(response.data);
	}

	public async rename(jwt: string, fileRecordId: EntityId, fileName: string): Promise<WebDavFileRecord> {
		const url = this.url(`/file/rename/${fileRecordId}`);
		const response = await this.request<FileRecordResponse>(() =>
			this.httpService.patch<FileRecordResponse>(url, { fileName }, { headers: this.authHeaders(jwt) })
		);

		return WebDavFilesStorageClient.mapFileRecord(response.data);
	}

	// the file keeps its id, so links to it stay valid
	public async move(
		jwt: string,
		fileRecordId: EntityId,
		schoolId: EntityId,
		parentId: EntityId
	): Promise<WebDavFileRecord> {
		const url = this.url(`/file/move/${fileRecordId}`);
		const target = {
			storageLocation: STORAGE_LOCATION,
			storageLocationId: schoolId,
			parentType: PARENT_TYPE,
			parentId,
		};
		const response = await this.request<FileRecordResponse>(() =>
			this.httpService.patch<FileRecordResponse>(url, { target }, { headers: this.authHeaders(jwt) })
		);

		return WebDavFilesStorageClient.mapFileRecord(response.data);
	}

	public async delete(jwt: string, fileRecordId: EntityId): Promise<void> {
		const url = this.url(`/file/delete/${fileRecordId}`);
		await this.request(() => this.httpService.delete(url, { headers: this.authHeaders(jwt) }));
	}

	private url(path: string): string {
		return new URL(`/api/v3${path}`, this.config.filesStorageBaseUrl).toString();
	}

	private authHeaders(jwt: string): RawAxiosRequestHeaders {
		return { Authorization: `Bearer ${jwt}` };
	}

	private async request<T>(call: () => ReturnType<HttpService['get']>): Promise<AxiosResponse<T>> {
		try {
			const response = (await lastValueFrom(call())) as AxiosResponse<T>;

			return response;
		} catch (error: unknown) {
			throw WebDavFilesStorageClient.mapError(error);
		}
	}

	// keep the meaning of file storage errors, but never leak their bodies to the client
	private static mapError(error: unknown): WebDavError {
		if (error instanceof AxiosError && error.response) {
			const { status } = error.response;
			if (PASSED_THROUGH_ERROR_STATUSES.includes(status)) {
				return new WebDavError(status, `File storage answered ${status}`);
			}
			if (status === 401) {
				return WebDavError.badGateway('File storage rejected the minted JWT');
			}
		}

		return WebDavError.badGateway(error instanceof Error ? error.message : 'File storage request failed');
	}

	private static mapFileRecord(fileRecord: FileRecordResponse): WebDavFileRecord {
		return {
			id: fileRecord.id,
			name: fileRecord.name,
			size: fileRecord.size,
			mimeType: fileRecord.mimeType,
			parentId: fileRecord.parentId,
			createdAt: new Date(fileRecord.createdAt),
			updatedAt: new Date(fileRecord.updatedAt),
		};
	}
}
