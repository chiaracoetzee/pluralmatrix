import { handleEvent, prisma, setAsToken } from './bot';
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
    getRoomStateEvent: jest.fn().mockResolvedValue({ algorithm: "m.megolm.v1.aes-sha2" }),
    getJoinedRoomMembers: jest.fn().mockResolvedValue(["@alice:localhost", "@_plural_seraphim_lily:localhost"]),
    homeserverUrl: "http://localhost:8008",
    doRequest: jest.fn()
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

// Mock Machine for decryption in tests
jest.mock('./bot', () => {
    const original = jest.requireActual('./bot');
    return {
        ...original,
        cryptoManager: {
            getMachine: jest.fn().mockResolvedValue({
                deviceId: { toString: () => "MOCK_DEVICE" },
                decryptRoomEvent: jest.fn().mockResolvedValue({
                    event: JSON.stringify({ type: "m.room.message", content: { body: "Decrypted Text" } })
                })
            })
        }
    };
});

describe('Bot Commands Resolution Tests', () => {
    const roomId = "!room:localhost";
    const sender = "@alice:localhost";

    beforeEach(() => {
        jest.clearAllMocks();
        setAsToken("mock_token");

        const { proxyCache } = require('./services/cache');
        proxyCache.getSystemRules.mockResolvedValue({
            slug: "seraphim",
            name: "Seraphim",
            members: [{
                slug: "lily",
                name: "Lily",
                displayName: "Lily 🌸",
                pronouns: "she/they",
                color: "ffcc00",
                description: "A friendly ghost.",
                proxyTags: [{ prefix: "l:", suffix: "" }]
            }]
        });
    });

    it('pk;message -delete should find the ROOT ID even if the latest event is an edit', async () => {
        const rootId = "$root_event";
        const editId = "$edit_event";

        mockBotClient.doRequest.mockResolvedValue({
            chunk: [
                {
                    event_id: editId,
                    type: "m.room.message",
                    sender: "@_plural_seraphim_lily:localhost",
                    content: {
                        body: "* Edited text",
                        "m.new_content": { body: "Edited text" },
                        "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                    }
                },
                {
                    event_id: rootId,
                    type: "m.room.message",
                    sender: "@_plural_seraphim_lily:localhost",
                    content: { body: "Original text" }
                }
            ]
        });

        const req = new Request({
            data: {
                type: "m.room.message",
                event_id: "$cmd_event",
                room_id: roomId,
                sender: sender,
                content: { body: "pk;message -delete" }
            }
        });

        await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, "UserRequest");
    });

    it('pk;edit should correctly resolve chained edits from history', async () => {
        const rootId = "$root_event";
        const editId = "$edit_event";

        mockBotClient.doRequest.mockResolvedValue({
            chunk: [
                {
                    event_id: editId,
                    type: "m.room.message",
                    sender: "@_plural_seraphim_lily:localhost",
                    content: {
                        body: "* Second Text",
                        "m.new_content": { body: "Second Text" },
                        "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                    }
                },
                {
                    event_id: rootId,
                    type: "m.room.message",
                    sender: "@_plural_seraphim_lily:localhost",
                    content: { body: "First Text" }
                }
            ]
        });

        const req = new Request({
            data: {
                type: "m.room.message",
                event_id: "$cmd_event",
                room_id: roomId,
                sender: sender,
                content: { body: "pk;e Final Text" }
            }
        });

        await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

        const { sendEncryptedEvent } = require('./crypto/encryption');
        expect(sendEncryptedEvent).toHaveBeenCalledWith(
            expect.anything(),
            roomId,
            "m.room.message",
            expect.objectContaining({
                "m.relates_to": { rel_type: "m.replace", event_id: rootId }
            }),
            expect.anything(),
            expect.anything()
        );
    });

    it('pk;list should use the encrypted rich text helper', async () => {
        const req = new Request({
            data: {
                type: "m.room.message",
                event_id: "$cmd_event",
                room_id: roomId,
                sender: sender,
                content: { body: "pk;list" }
            }
        });

        await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

        const { sendEncryptedEvent } = require('./crypto/encryption');
        expect(sendEncryptedEvent).toHaveBeenCalledWith(
            expect.anything(),
            roomId,
            "m.room.message",
            expect.objectContaining({
                msgtype: "m.text",
                format: "org.matrix.custom.html"
            }),
            expect.anything(),
            expect.anything()
        );
    });

    it('pk;member should show member details and use encrypted rich text', async () => {
        const req = new Request({
            data: {
                type: "m.room.message",
                event_id: "$cmd_event",
                room_id: roomId,
                sender: sender,
                content: { body: "pk;member lily" }
            }
        });

        await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

        const { sendEncryptedEvent } = require('./crypto/encryption');
        expect(sendEncryptedEvent).toHaveBeenCalledWith(
            expect.anything(),
            roomId,
            "m.room.message",
            expect.objectContaining({
                msgtype: "m.text",
                body: expect.stringContaining("Member Details: Lily"),
                format: "org.matrix.custom.html"
            }),
            expect.anything(),
            expect.anything()
        );
    });
});
