import { generateSlug, getCleanPrefix, extractNameFromDescription } from './import';

describe('Importer Logic', () => {
    describe('generateSlug', () => {
        it('should strip decorative emojis but keep the name', () => {
            const name = 'Lily 🌸✨';
            expect(generateSlug(name, 'abcde')).toBe('lily');
        });

        it('should transliterate Faux Cyrillic and decorative characters', () => {
            expect(generateSlug('S𐒰TVRN', 'abcde')).toBe('satvrn');
            expect(generateSlug('ДВЁИЯХУ', 'abcde')).toBe('abenrxy');
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
    });

    describe('getCleanPrefix', () => {
        it('should extract alphabetic characters and lowercase them', () => {
            expect(getCleanPrefix({ proxy_tags: [{ prefix: 'Ri:' }] })).toBe('ri');
            expect(getCleanPrefix({ proxy_tags: [{ prefix: '[Lily]' }] })).toBe('lily');
            expect(getCleanPrefix({ proxy_tags: [{ prefix: '123!@#' }] })).toBe('');
        });
    });

    describe('extractNameFromDescription', () => {
        it('should extract name from "I am [Name]"', () => {
            const desc = "Hello! I am Yami Luminara. I'm a goddess.";
            expect(extractNameFromDescription(desc)).toBe("Yami Luminara");
        });

        it('should extract name from "I\'m [Name]"', () => {
            const desc = "I'm Tyria! Nice to meet you.";
            expect(extractNameFromDescription(desc)).toBe("Tyria");
        });

        it('should extract name from "My name is [Name]"', () => {
            const desc = "My name is Luminara. I am light.";
            expect(extractNameFromDescription(desc)).toBe("Luminara");
        });

        it('should return null if no pattern matches', () => {
            const desc = "Just some random text about nothing.";
            expect(extractNameFromDescription(desc)).toBeNull();
        });
    });
});
