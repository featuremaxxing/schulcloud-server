// Board titles are free text, but they become path segments in a WebDAV drive. These
// helpers turn them into names every common client (Finder, Windows Explorer, rclone)
// can handle, and make them unique among siblings - boards happily allow two cards with
// the same title, a file system does not.

// characters Windows refuses in file names, plus both path separators
const FORBIDDEN_CHARACTERS = /[/\\:*?"<>|]/g;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const MAX_NAME_LENGTH = 200;

export const sanitizeName = (title: string | undefined, fallback: string): string => {
	const cleaned = (title ?? '')
		.replace(CONTROL_CHARACTERS, ' ')
		.replace(FORBIDDEN_CHARACTERS, '-')
		.replace(/\s+/g, ' ')
		.trim()
		// Windows silently strips trailing dots and spaces, which would break the round trip
		.replace(/[. ]+$/, '')
		.slice(0, MAX_NAME_LENGTH)
		.trim();

	return cleaned || fallback;
};

const withSuffix = (name: string, counter: number, keepExtension: boolean): string => {
	const extensionIndex = keepExtension ? name.lastIndexOf('.') : -1;
	if (extensionIndex > 0) {
		return `${name.slice(0, extensionIndex)} (${counter})${name.slice(extensionIndex)}`;
	}

	return `${name} (${counter})`;
};

/**
 * Assigns unique names to entries in their given order: the first entry keeps its name,
 * later duplicates get " (2)", " (3)", ... (before the extension for files). Comparison is
 * case-insensitive because macOS and Windows file systems are.
 */
export const assignUniqueNames = <T>(
	entries: T[],
	getName: (entry: T) => string,
	isFile: (entry: T) => boolean
): { entry: T; name: string }[] => {
	const usedNames = new Set<string>();

	return entries.map((entry) => {
		const baseName = getName(entry);
		let name = baseName;
		let counter = 2;
		while (usedNames.has(name.toLowerCase())) {
			name = withSuffix(baseName, counter, isFile(entry));
			counter += 1;
		}
		usedNames.add(name.toLowerCase());

		return { entry, name };
	});
};

// Metadata files operating systems write next to everything they touch. Storing them would
// clutter every card with "._Foto.jpg" elements, so they are accepted and silently dropped.
const SYSTEM_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized']);

export const isSystemFileName = (name: string): boolean => {
	const lowerCaseName = name.toLowerCase();

	return lowerCaseName.startsWith('._') || SYSTEM_FILE_NAMES.has(lowerCaseName);
};
