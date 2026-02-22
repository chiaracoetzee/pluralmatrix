import { generateSlug, getCleanPrefix, extractNameFromDescription, decommissionGhost } from './import';

// Mock Bridge
const mockIntent = {
    leave: jest.fn(),
    matrixClient: {
        getJoinedRooms: jest.fn(),
    }
};

const mockBridge = {
    getIntent: jest.fn().mockReturnValue(mockIntent),
};

jest.mock('./bot', () => ({
    getBridge: jest.fn(() => mockBridge),
    prisma: {
        system: { upsert: jest.fn() },
        member: { upsert: jest.fn() }
    }
}));

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

    describe('decommissionGhost', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should make the ghost leave all joined rooms', async () => {
            const member = { slug: 'ghost' };
            const system = { slug: 'sys' };
            
            mockIntent.matrixClient.getJoinedRooms.mockResolvedValue(['!room1:localhost', '!room2:localhost']);

            await decommissionGhost(member, system);

            expect(mockBridge.getIntent).toHaveBeenCalledWith(expect.stringContaining('@_plural_sys_ghost:'));
            expect(mockIntent.matrixClient.getJoinedRooms).toHaveBeenCalled();
            expect(mockIntent.leave).toHaveBeenCalledTimes(2);
            expect(mockIntent.leave).toHaveBeenCalledWith('!room1:localhost');
            expect(mockIntent.leave).toHaveBeenCalledWith('!room2:localhost');
        });

        it('should handle errors gracefully', async () => {
            mockIntent.matrixClient.getJoinedRooms.mockRejectedValue(new Error('API Fail'));
            await decommissionGhost({ slug: 'ghost' }, { slug: 'sys' });
            // Should not throw
        });
    });
});
