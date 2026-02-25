import { handleEvent } from './bot';
import { Request } from 'matrix-appservice-bridge';

// Mock dependencies
const mockPrisma = {
    system: {
        findFirst: jest.fn(),
        findUnique: jest.fn()
    },
    member: {
        findMany: jest.fn()
    }
};

const mockBotClient = {
    redactEvent: jest.fn().mockResolvedValue({}),
    getEvent: jest.fn(),
    getRoomStateEvent: jest.fn().mockResolvedValue({}),
    getJoinedRoomMembers: jest.fn().mockResolvedValue([]),
    homeserverUrl: "http://localhost:8008"
};

const mockIntent = {
    userId: "@_plural_test_lily:localhost",
    sendText: jest.fn(),
    sendEvent: jest.fn(),
    matrixClient: mockBotClient
};

const mockBridge = {
    getBot: () => ({
        getUserId: () => "@plural_bot:localhost",
        getClient: () => mockBotClient
    }),
    getIntent: (userId?: string) => mockIntent
};

// Mock the cache
jest.mock('./services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn()
    }
}));

// Mock encryption
jest.mock('./crypto/encryption', () => ({
    sendEncryptedEvent: jest.fn().mockImplementation((intent, roomId, type, content) => {
        return intent.sendEvent(roomId, type, content);
    })
}));

describe('Bot Event Handler', () => {
    const roomId = "!room:localhost";
    const sender = "@alice:localhost";

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Janitor Logic', () => {
        it('should redact empty messages from non-bridge users', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$event:localhost",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, mockPrisma as any);

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(
                roomId, '$event:localhost', 'ZeroFlash'
            );
        });
    });
});
