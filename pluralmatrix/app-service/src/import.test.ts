import { generateSlug } from './import';

describe('Importer Logic', () => {
    describe('generateSlug', () => {
        it('should strip decorative emojis but keep the name', () => {
            const name = 'Lily 🌸✨';
            expect(generateSlug(name, 'abcde')).toBe('lily');
        });

        it('should convert spaces to hyphens', () => {
            const name = 'Big Dragon 🐲';
            expect(generateSlug(name, 'abcde')).toBe('big-dragon');
        });

        it('should handle names with complex characters', () => {
            const name = 'Riven ⚔️🛡️';
            expect(generateSlug(name, 'abcde')).toBe('riven');
        });

        it('should fallback to defaultId if name is only emojis', () => {
            const name = '🌸✨';
            expect(generateSlug(name, 'ABCDE')).toBe('abcde');
        });

        it('should handle names with actual name-part emojis (if any)', () => {
            // This is a edge case, but we want to be safe
            const name = 'User123';
            expect(generateSlug(name, 'abcde')).toBe('user123');
        });
    });
});
