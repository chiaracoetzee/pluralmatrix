import { importFromPluralKit, exportToPluralKit, stringifyWithEscapedUnicode } from './import';
import { prisma } from './bot';

// Mock bot dependencies
jest.mock('./bot', () => ({
    ...jest.requireActual('./bot'),
    getBridge: jest.fn().mockReturnValue({
        getBot: () => ({
            getClient: () => ({
                uploadContent: jest.fn().mockResolvedValue('mxc://mock')
            })
        }),
        getIntent: jest.fn().mockReturnValue({
            ensureRegistered: jest.fn(),
            setDisplayName: jest.fn(),
            setAvatarUrl: jest.fn()
        })
    }),
    prisma: {
        system: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
        },
        member: {
            upsert: jest.fn(),
            findMany: jest.fn(),
        },
    },
}));

describe('PluralKit Roundtrip', () => {
    it('should import and then export with consistent data', async () => {
        const mockPkData = {
            version: 2,
            id: 'abcde',
            name: 'Test System',
            tag: '[Test]',
            members: [
                {
                    id: 'mem01',
                    name: 'Alice',
                    display_name: 'Alice 🌸',
                    description: 'A test member',
                    pronouns: 'She/Her',
                    color: 'ff00ff',
                    avatar_url: 'https://example.com/avatar.png',
                    proxy_tags: [{ prefix: 'a:', suffix: '' }]
                }
            ]
        };

        // Capture what is "saved" during import
        let savedSystem: any;
        let savedMembers: any[] = [];

        (prisma.system.upsert as jest.Mock).mockImplementation((args) => {
            savedSystem = { ...args.create, createdAt: new Date() };
            return Promise.resolve(savedSystem);
        });

        (prisma.member.upsert as jest.Mock).mockImplementation((args) => {
            const member = { ...args.create, id: 'mock-uuid', createdAt: new Date() };
            savedMembers.push(member);
            return Promise.resolve(member);
        });

        // 1. Run Import
        await importFromPluralKit('@user:localhost', mockPkData);

        // 2. Setup mock for Export
        (prisma.system.findUnique as jest.Mock).mockResolvedValue({
            ...savedSystem,
            members: savedMembers
        });

        // 3. Run Export
        const exportedData = await exportToPluralKit('@user:localhost');

        // 4. Verify roundtrip consistency
        expect(exportedData).toBeDefined();
        expect(exportedData?.name).toBe(mockPkData.name);
        expect(exportedData?.tag).toBe(mockPkData.tag);
        expect(exportedData?.members).toHaveLength(1);
        
        const m = exportedData?.members[0];
        expect(m?.name).toBe(mockPkData.members[0].name);
        expect(m?.display_name).toBe(mockPkData.members[0].display_name);
        expect(m?.description).toBe(mockPkData.members[0].description);
        expect(m?.pronouns).toBe(mockPkData.members[0].pronouns);
        expect(m?.color).toBe(mockPkData.members[0].color);
        expect(m?.proxy_tags).toEqual(mockPkData.members[0].proxy_tags);
    });

    describe('stringifyWithEscapedUnicode', () => {
        it('should escape non-ASCII characters correctly', () => {
            const data = { name: "Lily 🌸", role: "Goddess é" };
            const escaped = stringifyWithEscapedUnicode(data);
            
            // Should contain \u escapes
            expect(escaped).toContain("\\ud83c\\udf38"); // 🌸
            expect(escaped).toContain("\\u00e9"); // é
            
            // Should be valid JSON when parsed
            const parsed = JSON.parse(escaped);
            expect(parsed.name).toBe("Lily 🌸");
            expect(parsed.role).toBe("Goddess é");
        });
    });
});
