import { assignUniqueNames, isSystemFileName, sanitizeName } from './webdav-names';

describe('webdav names', () => {
	describe('sanitizeName', () => {
		it('should keep ordinary titles', () => {
			expect(sanitizeName('Mathe 7b – Brüche', 'x')).toEqual('Mathe 7b – Brüche');
		});

		it('should replace path separators and characters Windows refuses', () => {
			expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j', 'x')).toEqual('a-b-c-d-e-f-g-h-i-j');
		});

		it('should collapse whitespace and control characters', () => {
			expect(sanitizeName('  Zeile\neins\t zwei  ', 'x')).toEqual('Zeile eins zwei');
		});

		it('should strip trailing dots', () => {
			expect(sanitizeName('Kapitel 1...', 'x')).toEqual('Kapitel 1');
		});

		it('should use the fallback for empty titles', () => {
			expect(sanitizeName(undefined, 'Unbenannt')).toEqual('Unbenannt');
			expect(sanitizeName('  ', 'Unbenannt')).toEqual('Unbenannt');
		});
	});

	describe('assignUniqueNames', () => {
		it('should suffix later duplicates case-insensitively, before the extension for files', () => {
			const entries = [
				{ name: 'Foto.jpg', file: true },
				{ name: 'foto.jpg', file: true },
				{ name: 'Karte', file: false },
				{ name: 'Karte', file: false },
				{ name: 'Foto.jpg', file: true },
			];

			const result = assignUniqueNames(
				entries,
				(entry) => entry.name,
				(entry) => entry.file
			).map(({ name }) => name);

			expect(result).toEqual(['Foto.jpg', 'foto (2).jpg', 'Karte', 'Karte (2)', 'Foto (3).jpg']);
		});

		it('should not treat a folder name with a dot as having an extension', () => {
			const result = assignUniqueNames(
				['v1.2', 'v1.2'],
				(entry) => entry,
				() => false
			).map(({ name }) => name);

			expect(result).toEqual(['v1.2', 'v1.2 (2)']);
		});
	});

	describe('isSystemFileName', () => {
		it.each(['._Foto.jpg', '.DS_Store', 'Thumbs.db', 'desktop.ini'])('should detect %s', (name) => {
			expect(isSystemFileName(name)).toBe(true);
		});

		it.each(['Foto.jpg', '.htaccess', 'Arbeitsblatt.pdf'])('should not detect %s', (name) => {
			expect(isSystemFileName(name)).toBe(false);
		});
	});
});
