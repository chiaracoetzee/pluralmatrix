import { handleEvent } from './bot';
import { Request } from 'matrix-appservice-bridge';
import { proxyCache } from './services/cache';

jest.mock('./services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn(),
    }
}));

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
    getEvent: jest.fn(),
};

const mockBridge = {
    getIntent: jest.fn().mockReturnValue(mockIntent),
    getBot: jest.fn().mockReturnValue({
        getUserId: () => '@plural_bot:localhost',
        getClient: () => mockBotClient
    }),
};

const mockPrisma = {} as any;

describe('Proxy on Edit', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createEditRequest = (newBody: string, originalEventId: string, sender: string = '@user:localhost') => ({
        getData: () => ({
            type: 'm.room.message',
            sender,
            room_id: '!room:localhost',
            event_id: '$edit_event:localhost',
            content: {
                body: ` * ${newBody}`,
                "m.new_content": {
                    msgtype: "m.text",
                    body: newBody
                },
                "m.relates_to": {
                    rel_type: "m.replace",
                    event_id: originalEventId
                }
            }
        })
    } as unknown as Request<any>);

    it('should proxy when a message is edited to include a valid prefix', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue({
            slug: 'test-system',
            members: [
                { 
                    name: 'Lily', 
                    slug: 'lily', 
                    proxyTags: [{ prefix: 'Li:' }] 
                }
            ]
        });

        // Mock original event as not redacted
        mockBotClient.getEvent.mockResolvedValue({
            unsigned: {}
        });

        // Simulate editing a previously non-proxied message to have a prefix
        const req = createEditRequest('Li: Hello world', '$original_event:localhost');
        await handleEvent(req, undefined, mockBridge as any, mockPrisma);

        // It should redact the edit event
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(
            '!room:localhost', '$edit_event:localhost', expect.any(String)
        );

        // It should redact the original event
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(
            '!room:localhost', '$original_event:localhost', expect.any(String)
        );

        // It should send the ghost message WITHOUT m.replace
        expect(mockIntent.sendEvent).toHaveBeenCalledWith(
            '!room:localhost',
            'm.room.message',
            expect.not.objectContaining({
                "m.relates_to": expect.objectContaining({
                    rel_type: "m.replace"
                })
            })
        );
        
        // Verify body
        const sentContent = mockIntent.sendEvent.mock.calls[0][2];
        expect(sentContent.body).toBe('Hello world');
    });

    it('should NOT proxy when editing a message already proxied BY THE BOT', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue({
            slug: 'test-system',
            members: [
                { 
                    name: 'Lily', 
                    slug: 'lily', 
                    proxyTags: [{ prefix: 'Li:' }] 
                }
            ]
        });

        // Mock original event as ALREADY redacted BY THE BOT
        mockBotClient.getEvent.mockResolvedValue({
            unsigned: {
                redacted_by: '@plural_bot:localhost'
            }
        });

        const req = createEditRequest('Li: Hello again', '$original_event:localhost');
        await handleEvent(req, undefined, mockBridge as any, mockPrisma);

        // It should NOT redact or proxy again
        expect(mockBotClient.redactEvent).not.toHaveBeenCalled();
        expect(mockIntent.sendEvent).not.toHaveBeenCalled();
    });

    it('should proxy when a DECRYPTED message is edited to include a valid prefix', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue({
            slug: 'test-system',
            members: [
                { 
                    name: 'Lily', 
                    slug: 'lily', 
                    proxyTags: [{ prefix: 'Li:' }] 
                }
            ]
        });

        // Mock original event as NOT redacted
        mockBotClient.getEvent.mockResolvedValue({
            unsigned: {}
        });

        // Decrypted events from decrypterService usually look like this:
        const req = {
            getData: () => ({
                type: 'm.room.message',
                sender: '@user:localhost',
                room_id: '!room:localhost',
                event_id: '$edit_event:localhost',
                content: {
                    body: 'Li: Hello world decrypted',
                    "m.new_content": {
                        msgtype: "m.text",
                        body: "Li: Hello world decrypted"
                    },
                    "m.relates_to": {
                        rel_type: "m.replace",
                        event_id: "$original_event:localhost"
                    }
                }
            })
        } as unknown as Request<any>;

        await handleEvent(req, undefined, mockBridge as any, mockPrisma);

        // It should redact the edit event
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(
            '!room:localhost', '$edit_event:localhost', expect.any(String)
        );

        // It should redact the original event
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(
            '!room:localhost', '$original_event:localhost', expect.any(String)
        );

        // It should send the ghost message WITHOUT m.replace
        expect(mockIntent.sendEvent).toHaveBeenCalledWith(
            '!room:localhost',
            'm.room.message',
            expect.not.objectContaining({
                "m.relates_to": expect.objectContaining({
                    rel_type: "m.replace"
                })
            })
        );

        // Verify body
        const sentContent = mockIntent.sendEvent.mock.calls[0][2];
        expect(sentContent.body).toBe('Hello world decrypted');
    });
});
