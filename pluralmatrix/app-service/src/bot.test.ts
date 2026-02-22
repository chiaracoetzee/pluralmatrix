import { handleEvent } from './bot';
import { Request } from 'matrix-appservice-bridge';

// Mock everything needed for the bot logic
const mockIntent = {
    sendText: jest.fn(),
    sendEvent: jest.fn(),
    join: jest.fn(),
    sendStateEvent: jest.fn(),
    setDisplayName: jest.fn(),
    setAvatarUrl: jest.fn(),
    setPowerLevel: jest.fn(),
};

const mockBotClient = {
    redactEvent: jest.fn(),
};

const mockBridge = {
    getIntent: jest.fn().mockReturnValue(mockIntent),
    getBot: jest.fn().mockReturnValue({
        getUserId: () => '@plural_bot:localhost',
        getClient: () => mockBotClient
    }),
};

// Mock Prisma Client
const mockPrisma = {
    system: {
        findUnique: jest.fn(),
    },
    member: {
        findFirst: jest.fn(),
    },
};

describe('Bot Event Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createRequest = (content: any, sender: string = '@user:localhost') => ({
        getData: () => ({
            type: 'm.room.message',
            content,
            sender,
            room_id: '!room:localhost',
            event_id: '$event:localhost'
        })
    } as unknown as Request<any>);

    describe('Janitor Logic', () => {
        it('should redact empty messages from non-bridge users', async () => {
            const req = createRequest({ body: '   ' }); // Empty body
            await handleEvent(req, undefined, mockBridge as any, mockPrisma as any);

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(
                '!room:localhost', '$event:localhost', 'EmptyBody'
            );
        });

        it('should NOT redact empty messages from bridge users', async () => {
            const req = createRequest({ body: '   ' }, '@_plural_ghost:localhost');
            await handleEvent(req, undefined, mockBridge as any, mockPrisma as any);

            expect(mockBotClient.redactEvent).not.toHaveBeenCalled();
        });
    });

    describe('Commands', () => {
        it('should handle pk;list command', async () => {
            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue({
                name: 'Test System',
                members: [
                    { name: 'Alice', slug: 'alice', proxyTags: [{ prefix: 'a:' }] },
                    { name: 'Bob', slug: 'bob', proxyTags: [{ prefix: 'b:' }] }
                ]
            });

            const req = createRequest({ body: 'pk;list' });
            await handleEvent(req, undefined, mockBridge as any, mockPrisma as any);

            // Verify it sends a message
            expect(mockIntent.sendEvent).toHaveBeenCalled();
            // Verify content contains member names
            const callArgs = mockIntent.sendEvent.mock.calls[0];
            expect(callArgs[2].body).toContain('Alice');
            expect(callArgs[2].body).toContain('Bob');
        });

        it('should handle pk;member command', async () => {
            (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue({
                name: 'Alice',
                slug: 'alice',
                description: 'A test member',
                proxyTags: [{ prefix: 'a:' }]
            });

            const req = createRequest({ body: 'pk;member alice' });
            await handleEvent(req, undefined, mockBridge as any, mockPrisma as any);

            expect(mockIntent.sendEvent).toHaveBeenCalled();
            const callArgs = mockIntent.sendEvent.mock.calls[0];
            expect(callArgs[2].body).toContain('Member Details: Alice');
            expect(callArgs[2].body).toContain('A test member');
        });
    });
});
