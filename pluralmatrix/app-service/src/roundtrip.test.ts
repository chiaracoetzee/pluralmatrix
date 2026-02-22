import { importFromPluralKit, exportToPluralKit, stringifyWithEscapedUnicode, exportAvatarsZip, importAvatarsZip } from './import';
import { prisma } from './bot';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';

// Stable mocks for deep nesting
const mockBotClient = {
    uploadContent: jest.fn().mockResolvedValue('mxc://mock')
};

const mockIntent = {
    ensureRegistered: jest.fn(),
    setDisplayName: jest.fn(),
    setAvatarUrl: jest.fn(),
    leave: jest.fn(),
    matrixClient: {
        getJoinedRooms: jest.fn(),
    }
};

const mockBridge = {
    getBot: () => ({
        getClient: () => mockBotClient
    }),
    getIntent: jest.fn().mockReturnValue(mockIntent)
};

// Mock bot dependencies
jest.mock('./bot', () => ({
    ...jest.requireActual('./bot'),
    getBridge: jest.fn(() => mockBridge),
    prisma: {
        system: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
        },
        member: {
            upsert: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
    },
}));

describe('PluralKit Roundtrip', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

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

    describe('Avatar ZIP Roundtrip', () => {
        it('should export avatars to a ZIP stream with correct data', async () => {
            const fakeImageData = Buffer.from('fake-image-binary-data-123');
            const mockSystem = {
                ownerId: '@user:localhost',
                members: [
                    { name: 'Alice', avatarUrl: 'mxc://localhost/media1' }
                ]
            };
            (prisma.system.findUnique as jest.Mock).mockResolvedValue(mockSystem);

            // Mock fetch for the media download
            // We ensure we return a proper ArrayBuffer matching the buffer content
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                headers: new Map([['content-type', 'image/png']]),
                arrayBuffer: () => Promise.resolve(new Uint8Array(fakeImageData).buffer)
            });

            const zipStream = new PassThrough();
            const chunks: any[] = [];
            zipStream.on('data', (chunk) => chunks.push(chunk));

            const exportPromise = exportAvatarsZip('@user:localhost', zipStream);
            
            // Wait for the stream to finish properly
            await new Promise((resolve) => zipStream.on('finish', resolve));
            await exportPromise;

            const zipBuffer = Buffer.concat(chunks);
            const zip = new AdmZip(zipBuffer);
            const entries = zip.getEntries();

            expect(entries).toHaveLength(1);
            expect(entries[0].entryName).toBe('media1.png');
            // Compare as strings or buffers directly
            expect(entries[0].getData().toString()).toBe(fakeImageData.toString());
        });

        it('should import avatars from a ZIP and re-upload exact binary data', async () => {
            const originalData = Buffer.from('binary-content-to-preserve');
            const mockSystem = {
                id: 'sys1',
                slug: 'mysys',
                members: [
                    { id: 'm1', slug: 'alice', avatarUrl: 'mxc://old/media1' }
                ]
            };
            (prisma.system.findUnique as jest.Mock).mockResolvedValue(mockSystem);
            (prisma.member.update as jest.Mock).mockResolvedValue({ id: 'm1', avatarUrl: 'mxc://new/uploaded' });

            const zip = new AdmZip();
            zip.addFile('media1.png', originalData);
            const zipBuffer = zip.toBuffer();

            mockBotClient.uploadContent.mockResolvedValue('mxc://new/uploaded');

            const count = await importAvatarsZip('@user:localhost', zipBuffer);

            expect(count).toBe(1);
            
            // Verify that the data uploaded to Matrix matches the data in the ZIP
            expect(mockBotClient.uploadContent).toHaveBeenCalledWith(
                originalData,
                'image/png',
                'media1.png'
            );

            expect(prisma.member.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'm1' },
                data: { avatarUrl: 'mxc://new/uploaded' }
            }));
        });
    });
});
