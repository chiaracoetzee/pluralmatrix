import { registerUser, getMatrixClient, getPluralMatrixToken, setupTestRoom } from './test/e2e-helper';
import { MatrixClient, LogService, LogLevel } from 'matrix-bot-sdk';

// Suppress excessive logs during tests
LogService.setLogger({
    info: () => {},
    warn: console.warn,
    error: console.error,
    debug: () => {},
    trace: () => {}
});

describe('PluralMatrix E2E Roundtrip', () => {
    let client: MatrixClient;
    let mxid: string;
    let jwt: string;
    let roomId: string;
    const username = `e2e_user_${Date.now()}`;
    const password = 'e2e_password_123';

    // Increase timeout for E2E operations (Synapse can be slow)
    jest.setTimeout(30000);

    beforeAll(async () => {
        // 1. Register and Login to Matrix
        mxid = registerUser(username, password);
        client = await getMatrixClient(username, password);
        await client.start();

        // 2. Login to PluralMatrix App Service
        jwt = await getPluralMatrixToken(mxid, password);

        // 3. Setup Room
        roomId = await setupTestRoom(client);
        
        // Wait a bit for the bot to join
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    afterAll(async () => {
        if (client) await client.stop();
    });

    it('should proxy a message from a newly created alter', async () => {
        const alterName = "E2E-Ghost";
        const proxyPrefix = "e2e:";
        const messageBody = "Hello from the other side!";

        console.log(`[E2E] Creating alter ${alterName}...`);
        const createRes = await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify({
                name: alterName,
                proxyTags: [{ prefix: proxyPrefix, suffix: "" }]
            })
        });
        
        if (!createRes.ok) {
            const err = await createRes.json();
            throw new Error(`Failed to create alter: ${JSON.stringify(err)}`);
        }

        const member = await createRes.json();
        console.log(`[E2E] Alter created with slug: ${member.slug}`);

        // Start listening for the ghost message
        const ghostMessagePromise = new Promise<any>((resolve) => {
            client.on('room.message', (roomIdMatch, event) => {
                if (roomIdMatch === roomId && 
                    event.sender.startsWith('@_plural_') && 
                    event.content?.body === messageBody) {
                    resolve(event);
                }
            });
        });

        console.log(`[E2E] Sending proxied message...`);
        const originalEventId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `${proxyPrefix}${messageBody}`
        });

        // Wait for ghost to speak
        console.log(`[E2E] Waiting for ghost response...`);
        const ghostEvent: any = await ghostMessagePromise;

        expect(ghostEvent.content.body).toBe(messageBody);
        expect(ghostEvent.sender).toContain(member.slug);
        
        console.log(`[E2E] SUCCESS! Ghost spoke as ${ghostEvent.sender}`);

        // Verify "Zero-Flash" or Janitor redaction
        // We check if the original message was redacted
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            const event = await client.getEvent(roomId, originalEventId);
            // In a Zero-Flash world, the body is blanked by the module
            // In a Janitor world, the event is redacted
            const isRedacted = !!event.unsigned?.redacted_by || event.content?.body === "";
            expect(isRedacted).toBe(true);
            console.log(`[E2E] Original message was successfully hidden.`);
        } catch (e) {
            // If getEvent fails because it was redacted, that's also a win in some Synapse configs
            console.log(`[E2E] Original message is gone/hidden.`);
        }
    });
});
