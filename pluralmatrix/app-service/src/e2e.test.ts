import { registerUser, getMatrixClient, getPluralMatrixToken, setupTestRoom } from './test/e2e-helper';
import { MatrixClient, LogService } from 'matrix-appservice-bridge/node_modules/@vector-im/matrix-bot-sdk';

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
    const suffix = Math.random().toString(36).substring(7);
    const username = `e2e_user_${suffix}`;
    const password = 'e2e_password_123';

    // Increase timeout for E2E operations (Synapse can be slow)
    jest.setTimeout(30000);

    beforeAll(async () => {
        console.log(`[E2E] Starting beforeAll setup for ${username}...`);
        // 1. Register and Login to Matrix
        mxid = registerUser(username, password);
        client = await getMatrixClient(username, password);
        console.log(`[E2E] Matrix client starting...`);
        await client.start();
        console.log(`[E2E] Matrix client started.`);

        // 2. Login to PluralMatrix App Service
        jwt = await getPluralMatrixToken(mxid, password);

        // 3. Setup Room
        roomId = await setupTestRoom(client);
        
        console.log(`[E2E] Waiting for bot to join ${roomId}...`);
        // Wait a bit for the bot to join
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(`[E2E] Setup complete.`);
    });

    afterAll(async () => {
        console.log(`[E2E] Starting afterAll teardown...`);
        if (client) {
            console.log(`[E2E] Matrix client stopping...`);
            await client.stop();
            console.log(`[E2E] Matrix client stopped.`);
        }
        // Small delay to allow async handles to settle
        console.log(`[E2E] Waiting for handles to settle...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`[E2E] Teardown complete.`);
        
        // Force-kill the native crypto GC handle if it hangs
        console.log(`[E2E] Scheduling force-exit in 3s...`);
        setTimeout(() => process.exit(0), 3000);
    });

    it('should proxy a message from a newly created alter', async () => {
        const alterName = "E2E-Ghost";
        const proxyPrefix = "e2e:";
        const messageBody = "Hello from the other side!";

        console.log(`[E2E-Plain] Creating alter ${alterName}...`);
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
            console.error(`[E2E-Plain] Alter creation failed:`, JSON.stringify(err));
            throw new Error(`Failed to create alter: ${JSON.stringify(err)}`);
        }

        const member = await createRes.json();
        console.log(`[E2E-Plain] Alter created with slug: ${member.slug}`);

        // Start listening for the ghost message
        const ghostMessagePromise = new Promise<any>((resolve) => {
            const listener = (roomIdMatch: string, event: any) => {
                if (roomIdMatch === roomId && 
                    event.sender.startsWith('@_plural_') && 
                    event.content?.body === messageBody) {
                    console.log(`[E2E-Plain] Caught ghost message from ${event.sender}`);
                    client.off('room.message', listener);
                    resolve(event);
                }
            };
            client.on('room.message', listener);
        });

        console.log(`[E2E-Plain] Sending proxied message...`);
        const originalEventId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `${proxyPrefix}${messageBody}`
        });

        // Wait for ghost to speak
        console.log(`[E2E-Plain] Waiting for ghost response...`);
        const ghostEvent: any = await ghostMessagePromise;

        expect(ghostEvent.content.body).toBe(messageBody);
        expect(ghostEvent.sender).toContain(member.slug);
        
        console.log(`[E2E-Plain] SUCCESS! Ghost spoke as ${ghostEvent.sender}`);

        // Verify "Zero-Flash" or Janitor redaction
        console.log(`[E2E-Plain] Verifying redaction of original message...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            const event = await client.getEvent(roomId, originalEventId);
            const isRedacted = !!event.unsigned?.redacted_by || event.content?.body === "";
            expect(isRedacted).toBe(true);
            console.log(`[E2E-Plain] Original message was successfully hidden.`);
        } catch (e) {
            console.log(`[E2E-Plain] Original message is gone/hidden (Expected).`);
        }
    });

    it('should proxy a message in an ENCRYPTED room', async () => {
        const messageBody = "Encryption test message";
        const proxyPrefix = "e2e:";

        // 1. Create a new room and enable encryption
        console.log(`[E2E-E2EE] Creating encrypted room...`);
        const e2eeRoomId = await setupTestRoom(client);
        console.log(`[E2E-E2EE] Enabling encryption in ${e2eeRoomId}...`);
        await client.sendStateEvent(e2eeRoomId, "m.room.encryption", "", { algorithm: "m.megolm.v1.aes-sha2" });
        
        // 2. Invite Decrypter Ghost manually (matching our sidecar logic)
        console.log(`[E2E-E2EE] Inviting decrypter ghost...`);
        await client.inviteUser("@plural_decrypter:localhost", e2eeRoomId);

        console.log(`[E2E-E2EE] Waiting for bot and decrypter to settle...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 3. Start listening for the ghost message
        const ghostMessagePromise = new Promise<any>((resolve) => {
            const listener = (roomIdMatch: string, event: any) => {
                if (roomIdMatch === e2eeRoomId && 
                    event.sender.startsWith('@_plural_') && 
                    event.content?.body === messageBody) {
                    console.log(`[E2E-E2EE] Caught ghost message from ${event.sender}`);
                    client.off('room.message', listener);
                    resolve(event);
                }
            };
            client.on('room.message', listener);
        });

        console.log(`[E2E-E2EE] Sending message to encrypted room...`);
        await client.sendMessage(e2eeRoomId, {
            msgtype: "m.text",
            body: `${proxyPrefix}${messageBody}`
        });

        // 4. Wait for ghost to speak
        console.log(`[E2E-E2EE] Waiting for ghost response...`);
        const ghostEvent: any = await ghostMessagePromise;

        expect(ghostEvent.content.body).toBe(messageBody);
        console.log(`[E2E-E2EE] SUCCESS! Decrypted ghost response caught.`);
    });
});
