import { parseLockOwner, parsePropPatchNames, renderMultiStatus, renderPropPatchResponse } from './webdav-xml';

describe('webdav xml', () => {
	describe('renderMultiStatus', () => {
		it('should render collections and files with escaped values', () => {
			const xml = renderMultiStatus([
				{ href: '/webdav/Kurse/', displayName: 'Kurse', isCollection: true },
				{
					href: '/webdav/a%26b.pdf',
					displayName: 'a&b.pdf',
					isCollection: false,
					contentLength: 42,
					contentType: 'application/pdf',
					updatedAt: new Date('2026-09-28T10:00:00Z'),
					etag: '"1-2"',
				},
			]);

			expect(xml).toContain('<D:href>/webdav/Kurse/</D:href>');
			expect(xml).toContain('<D:resourcetype><D:collection/></D:resourcetype>');
			expect(xml).toContain('<D:displayname>a&amp;b.pdf</D:displayname>');
			expect(xml).toContain('<D:getcontentlength>42</D:getcontentlength>');
			expect(xml).toContain('<D:getlastmodified>Mon, 28 Sep 2026 10:00:00 GMT</D:getlastmodified>');
			expect(xml).toContain('<D:getetag>&quot;1-2&quot;</D:getetag>');
		});
	});

	describe('parsePropPatchNames', () => {
		it('should return the names and namespaces of all set properties', async () => {
			const body = `<?xml version="1.0" encoding="utf-8" ?>
				<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">
					<D:set><D:prop>
						<Z:Win32CreationTime>Mon, 28 Sep 2026 10:00:00 GMT</Z:Win32CreationTime>
						<Z:Win32FileAttributes>00000020</Z:Win32FileAttributes>
					</D:prop></D:set>
				</D:propertyupdate>`;

			const names = await parsePropPatchNames(body);

			expect(names).toEqual([
				{ namespace: 'urn:schemas-microsoft-com:', name: 'Win32CreationTime' },
				{ namespace: 'urn:schemas-microsoft-com:', name: 'Win32FileAttributes' },
			]);

			const response = renderPropPatchResponse('/webdav/a.pdf', names);
			expect(response).toContain('xmlns:ns0="urn:schemas-microsoft-com:"');
			expect(response).toContain('<ns0:Win32CreationTime/>');
		});

		it('should return an empty list for invalid xml', async () => {
			await expect(parsePropPatchNames('<not xml')).resolves.toEqual([]);
		});
	});

	describe('parseLockOwner', () => {
		it('should read the owner href', async () => {
			const body = `<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>
				<D:locktype><D:write/></D:locktype><D:owner><D:href>http://www.apple.com/webdav_fs/</D:href></D:owner></D:lockinfo>`;

			await expect(parseLockOwner(body)).resolves.toEqual('http://www.apple.com/webdav_fs/');
		});
	});
});
