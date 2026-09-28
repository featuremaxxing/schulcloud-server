import { parseStringPromise } from 'xml2js';

export interface WebDavPropEntry {
	href: string;
	displayName: string;
	isCollection: boolean;
	contentLength?: number;
	contentType?: string;
	createdAt?: Date;
	updatedAt?: Date;
	etag?: string;
}

export interface WebDavLockInfo {
	token: string;
	href: string;
	owner?: string;
	timeoutSeconds: number;
	depth: '0' | 'infinity';
}

export interface QualifiedName {
	namespace: string;
	name: string;
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';

export const escapeXml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

const renderProps = (entry: WebDavPropEntry): string => {
	const props = [
		`<D:displayname>${escapeXml(entry.displayName)}</D:displayname>`,
		entry.isCollection ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>',
	];

	if (!entry.isCollection) {
		props.push(`<D:getcontentlength>${entry.contentLength ?? 0}</D:getcontentlength>`);
		props.push(`<D:getcontenttype>${escapeXml(entry.contentType || 'application/octet-stream')}</D:getcontenttype>`);
	}
	if (entry.createdAt) {
		props.push(`<D:creationdate>${entry.createdAt.toISOString()}</D:creationdate>`);
	}
	if (entry.updatedAt) {
		props.push(`<D:getlastmodified>${entry.updatedAt.toUTCString()}</D:getlastmodified>`);
	}
	if (entry.etag) {
		props.push(`<D:getetag>${escapeXml(entry.etag)}</D:getetag>`);
	}
	props.push(
		'<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>',
		'<D:lockdiscovery/>'
	);

	return props.join('');
};

export const renderMultiStatus = (entries: WebDavPropEntry[]): string => {
	const responses = entries
		.map(
			(entry) =>
				`<D:response><D:href>${escapeXml(entry.href)}</D:href><D:propstat><D:prop>${renderProps(
					entry
				)}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
		)
		.join('');

	return `${XML_HEADER}<D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
};

/**
 * Answers a PROPPATCH as if every property had been stored. Windows writes its Win32
 * timestamps this way after each upload and treats a failure as a failed copy; the board
 * has nowhere to keep them, and nothing reads them back.
 */
export const renderPropPatchResponse = (href: string, names: QualifiedName[]): string => {
	const namespaces = Array.from(new Set(names.map((name) => name.namespace).filter((ns) => ns && ns !== 'DAV:')));
	const prefixFor = (namespace: string): string =>
		namespace === 'DAV:' || !namespace ? 'D' : `ns${namespaces.indexOf(namespace)}`;
	const namespaceDeclarations = namespaces.map((ns, index) => ` xmlns:ns${index}="${escapeXml(ns)}"`).join('');
	const props = names.map((name) => `<${prefixFor(name.namespace)}:${name.name}/>`).join('');

	return `${XML_HEADER}<D:multistatus xmlns:D="DAV:"${namespaceDeclarations}><D:response><D:href>${escapeXml(
		href
	)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
};

export const renderLockResponse = (lock: WebDavLockInfo): string => {
	const owner = lock.owner ? `<D:owner>${escapeXml(lock.owner)}</D:owner>` : '';

	return `${XML_HEADER}<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>${
		lock.depth
	}</D:depth>${owner}<D:timeout>Second-${lock.timeoutSeconds}</D:timeout><D:locktoken><D:href>${escapeXml(
		lock.token
	)}</D:href></D:locktoken><D:lockroot><D:href>${escapeXml(
		lock.href
	)}</D:href></D:lockroot></D:activelock></D:lockdiscovery></D:prop>`;
};

interface XmlNode {
	$ns?: { uri: string; local: string };
	_?: string;
	[key: string]: unknown;
}

const isXmlNode = (value: unknown): value is XmlNode => typeof value === 'object' && value !== null;

const childNodes = (node: XmlNode): XmlNode[] =>
	Object.entries(node)
		.filter(([key]) => key !== '$' && key !== '$ns' && key !== '_')
		.flatMap(([, value]) => (Array.isArray(value) ? (value as unknown[]) : [value]))
		.filter(isXmlNode);

const findDescendants = (node: XmlNode, localName: string): XmlNode[] =>
	childNodes(node).flatMap((child) => [
		...(child.$ns?.local === localName ? [child] : []),
		...findDescendants(child, localName),
	]);

const parseXml = async (body: string): Promise<XmlNode | undefined> => {
	if (!body.trim()) {
		return undefined;
	}

	try {
		const parsed: unknown = await parseStringPromise(body, { xmlns: true, explicitCharkey: true });

		return isXmlNode(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};

/** Names of all properties set or removed by a PROPPATCH body. */
export const parsePropPatchNames = async (body: string): Promise<QualifiedName[]> => {
	const root = await parseXml(body);
	if (!root) {
		return [];
	}

	return findDescendants(root, 'prop').flatMap((prop) =>
		childNodes(prop).map((child) => {
			return { namespace: child.$ns?.uri ?? '', name: child.$ns?.local ?? '' };
		})
	);
};

/** The owner of a LOCK request as plain text (clients put a name or URL there). */
export const parseLockOwner = async (body: string): Promise<string | undefined> => {
	const root = await parseXml(body);
	const [owner] = root ? findDescendants(root, 'owner') : [];
	if (!owner) {
		return undefined;
	}

	const texts = [owner, ...findDescendants(owner, 'href')].map((node) => node._?.trim()).filter(Boolean);

	return texts[0];
};
