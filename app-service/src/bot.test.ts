import { handleEvent, prisma, setAsToken, cryptoManager } from './bot';
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
    sendStateEvent: jest.fn().mockResolvedValue({}),
    getUserProfile: jest.fn().mockResolvedValue({ displayname: "Mock User" }),
    setRoomName: jest.fn().mockResolvedValue({}),
    homeserverUrl: "http://localhost:8008"
};

const mockIntent = {
    userId: "@_plural_test_lily:localhost",
    sendText: jest.fn(),
    sendEvent: jest.fn(),
    join: jest.fn().mockResolvedValue({}),
    invite: jest.fn().mockResolvedValue({}),
    setRoomName: jest.fn().mockResolvedValue({}),
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

// Mock crypto utils
jest.mock('./crypto/crypto-utils', () => ({
    registerDevice: jest.fn().mockResolvedValue(false),
    processCryptoRequests: jest.fn().mockResolvedValue({})
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
        setAsToken("mock_token");
        
        // Mock cryptoManager
        cryptoManager.getMachine = jest.fn().mockResolvedValue({
            deviceId: { toString: () => "MOCK_DEVICE" }
        });
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

    describe('Invite Handling', () => {
        it('should auto-join and forward invites for ghost users', async () => {
            const invitedGhost = "@_plural_seraphim_lily:localhost";
            const primaryUser = "@chiara:localhost";
            const req = new Request({
                data: {
                    type: "m.room.member",
                    room_id: roomId,
                    sender: "@alice:localhost",
                    state_key: invitedGhost,
                    content: { membership: "invite" }
                }
            });

            // Mock intents
            const ghostJoin = jest.fn().mockResolvedValue({});
            const ghostInvite = jest.fn().mockResolvedValue({});
            const ghostSend = jest.fn().mockResolvedValue({});
            const ghostSetName = jest.fn().mockResolvedValue({});
            const ghostSetTopic = jest.fn().mockResolvedValue({});
            
            const mockGhostIntent = {
                join: ghostJoin,
                invite: ghostInvite,
                sendEvent: ghostSend,
                setRoomName: ghostSetName,
                setRoomTopic: ghostSetTopic,
                matrixClient: mockBotClient
            };

            const localMockBridge = {
                ...mockBridge,
                getIntent: jest.fn((userId) => {
                    if (userId === invitedGhost) return mockGhostIntent;
                    return mockIntent;
                })
            };

            // Mock prisma lookup for system
            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue({
                id: "sys1",
                slug: "seraphim",
                accountLinks: [
                    { matrixId: primaryUser, isPrimary: true }
                ]
            });

            // Mock profiles
            mockBotClient.getUserProfile = jest.fn()
                .mockResolvedValueOnce({ displayname: "Alice" }) // for sender
                .mockResolvedValueOnce({ displayname: "Lily" }); // for ghost

            await handleEvent(req as any, undefined, localMockBridge as any, mockPrisma as any);

            expect(ghostJoin).toHaveBeenCalledWith(roomId);
            expect(ghostSetName).toHaveBeenCalledWith(roomId, "Alice, Lily");
            expect(ghostInvite).toHaveBeenCalledWith(roomId, primaryUser);
            expect(ghostInvite).toHaveBeenCalledWith(roomId, "@plural_bot:localhost");
            expect(ghostSetTopic).toHaveBeenCalledWith(roomId, expect.stringContaining("Waiting for account owner"));
        });
    });

    describe('Power Level Synchronization', () => {
        it('should promote bot and owner when they join a room with a ghost', async () => {
            const ghostUserId = "@_plural_seraphim_lily:localhost";
            const botUserId = "@plural_bot:localhost";
            const ownerUserId = "@chiara:localhost";
            
            const req = new Request({
                data: {
                    type: "m.room.member",
                    room_id: roomId,
                    sender: botUserId,
                    state_key: botUserId,
                    content: { membership: "join" }
                }
            });

            // Mock state
            mockBotClient.getJoinedRoomMembers = jest.fn().mockResolvedValue([ghostUserId, botUserId]);
            mockBotClient.getRoomStateEvent = jest.fn().mockResolvedValue({
                users: {
                    [ghostUserId]: 50,
                    [botUserId]: 0,
                    [ownerUserId]: 0
                },
                users_default: 0
            });
            const sendStateMock = jest.fn().mockResolvedValue({});
            mockBotClient.sendStateEvent = sendStateMock;

            // Mock prisma
            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue({
                id: "sys1",
                slug: "seraphim",
                accountLinks: [
                    { matrixId: ownerUserId, isPrimary: true }
                ]
            });

            await handleEvent(req as any, undefined, mockBridge as any, mockPrisma as any);

            // Should be called to promote bot and owner to PL 50 (ghost's level)
            expect(sendStateMock).toHaveBeenCalledWith(roomId, "m.room.power_levels", "", expect.objectContaining({
                users: expect.objectContaining({
                    [botUserId]: 50,
                    [ownerUserId]: 50
                })
            }));
        });

        it('should clear room topic when primary owner joins', async () => {
            const ghostUserId = "@_plural_seraphim_lily:localhost";
            const ownerUserId = "@chiara:localhost";
            
            const req = new Request({
                data: {
                    type: "m.room.member",
                    room_id: roomId,
                    sender: ownerUserId,
                    state_key: ownerUserId,
                    content: { membership: "join" }
                }
            });

            // Mock state
            mockBotClient.getJoinedRoomMembers = jest.fn().mockResolvedValue([ghostUserId, ownerUserId]);
            const ghostSetTopic = jest.fn().mockResolvedValue({});
            
            const mockGhostIntent = {
                ...mockIntent,
                setRoomTopic: ghostSetTopic
            };

            const localMockBridge = {
                ...mockBridge,
                getIntent: jest.fn((userId) => {
                    if (userId === ghostUserId) return mockGhostIntent;
                    return mockIntent;
                })
            };

            // Mock prisma
            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue({
                id: "sys1",
                slug: "seraphim",
                accountLinks: [
                    { matrixId: ownerUserId, isPrimary: true }
                ]
            });

            await handleEvent(req as any, undefined, localMockBridge as any, mockPrisma as any);

            // Should clear the topic
            expect(ghostSetTopic).toHaveBeenCalledWith(roomId, "");
        });
    });
});
