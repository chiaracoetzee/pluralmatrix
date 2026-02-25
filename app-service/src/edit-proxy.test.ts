import { handleEvent, prisma } from './bot';
import { Request } from 'matrix-appservice-bridge';

// Mock dependency: cache
jest.mock('./services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn()
    }
}));

// Mock bridge and intent
const mockBotClient = {
    redactEvent: jest.fn().mockResolvedValue({}),
    getEvent: jest.fn(),
    getRoomStateEvent: jest.fn().mockResolvedValue({}),
    getJoinedRoomMembers: jest.fn().mockResolvedValue([]),
    homeserverUrl: "http://localhost:8008"
};

const mockIntent = {
    userId: "@_plural_seraphim_lily:localhost",
    sendEvent: jest.fn().mockResolvedValue({ event_id: "$new_event" }),
    sendText: jest.fn(),
    join: jest.fn(),
    ensureRegistered: jest.fn(),
    setDisplayName: jest.fn(),
    setAvatarUrl: jest.fn(),
    matrixClient: mockBotClient
};

const mockBridge = {
    getBot: () => ({
        getUserId: () => "@plural_bot:localhost",
        getClient: () => mockBotClient
    }),
    getIntent: (userId?: string) => mockIntent
};

// Mock encryption
jest.mock('./crypto/encryption', () => ({
    sendEncryptedEvent: jest.fn().mockImplementation((intent, roomId, type, content) => {
        return intent.sendEvent(roomId, type, content);
    })
}));

describe('Proxy on Edit', () => {
    const roomId = "!room:localhost";
    const sender = "@alice:localhost";

    beforeEach(() => {
        jest.clearAllMocks();
        const { proxyCache } = require('./services/cache');
        proxyCache.getSystemRules.mockResolvedValue({
            slug: "seraphim",
            name: "Seraphim",
            members: [{
                slug: "lily",
                name: "Lily",
                proxyTags: [{ prefix: "l:", suffix: "" }]
            }]
        });
    });

    it('should proxy when a message is edited to include a valid prefix', async () => {
        const originalId = "$original_event:localhost";
        const editId = "$edit_event:localhost";

        // Mock original event
        mockBotClient.getEvent.mockResolvedValue({
            event_id: originalId,
            sender: sender,
            content: { body: "Original text" }
        });

        const req = new Request({
            data: {
                type: "m.room.message",
                event_id: editId,
                room_id: roomId,
                sender: sender,
                content: {
                    // CRITICAL: Matrix edits always have a fallback body
                    body: "* l: Proxied edit",
                    "m.new_content": { body: "l: Proxied edit" },
                    "m.relates_to": {
                        rel_type: "m.replace",
                        event_id: originalId
                    }
                }
            }
        });

        await handleEvent(req as any, undefined, mockBridge as any, prisma);

        // It should redact both the trigger edit and the original root
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, editId, "PluralProxy");
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, originalId, "PluralProxyOriginal");
    });
});
