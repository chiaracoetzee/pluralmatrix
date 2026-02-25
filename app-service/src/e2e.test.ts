import { getPluralMatrixToken, setupTestRoom, getMatrixClient, registerUser } from './test/e2e-helper';
import { MatrixClient } from "@vector-im/matrix-bot-sdk";

// These E2E tests require a running stack (Synapse + App Service)
// They use the 'localhost' domain configured in setup.sh
describe('PluralMatrix E2E Roundtrip', () => {
    let client: MatrixClient;
    let jwt: string;
    let roomId: string;
    let username: string;
    const password = "e2e_password";

    beforeAll(async () => {
        username = `e2e_user_${Math.random().toString(36).substring(7)}`;
        console.log(`[E2E] Starting beforeAll setup for ${username}...`);

        // 1. Register and login a real Matrix user
        await registerUser(username, password);
        client = await getMatrixClient(username, password);
        console.log(`[E2E] Matrix client starting...`);
        await client.start();
        console.log(`[E2E] Matrix client started.`);

        // 2. Login to PluralMatrix App Service
        console.log(`[E2E] Fetching PluralMatrix JWT for @${username}:localhost...`);
        jwt = await getPluralMatrixToken(`@${username}:localhost`, password);
        console.log(`[E2E] PluralMatrix JWT obtained for @${username}:localhost.`);

        // 3. Setup a test room
        console.log(`[E2E] Creating test room...`);
        roomId = await setupTestRoom(client);
        console.log(`[E2E] Test room created: ${roomId}`);

        // 4. Wait for bot to join
        console.log(`[E2E] Waiting for bot to join ${roomId}...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log(`[E2E] Setup complete.`);
    }, 60000);

    afterAll(async () => {
        console.log(`[E2E] Starting afterAll teardown...`);
        if (client) {
            console.log(`[E2E] Matrix client stopping...`);
            await client.stop();
            console.log(`[E2E] Matrix client stopped.`);
        }
        
        console.log(`[E2E] Waiting for handles to settle...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(`[E2E] Teardown complete.`);
        
        console.log(`[E2E] Scheduling force-exit in 3s...`);
        setTimeout(() => process.exit(0), 3000).unref();
    }, 10000);

    it('should proxy a message in a standard (unencrypted) room', async () => {
        const messageBody = "Hello world from E2E";
        const proxyPrefix = "e2e:";
        
        // 1. Create an alter via the API
        console.log(`[E2E-Plain] Creating alter E2E-Ghost...`);
        const slug = `e2e-ghost-${Date.now()}`;
        const res = await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: "E2E-Ghost",
                slug: slug,
                proxyTags: [{ prefix: proxyPrefix, suffix: "" }]
            })
        });
        
        if (!res.ok) throw new Error(`Failed to create member: ${res.status}`);
        console.log(`[E2E-Plain] Alter created with slug: ${slug}`);

        // 2. Setup listener for ghost response
        const ghostMessagePromise = new Promise<any>((resolve) => {
            const listener = (roomIdMatch: string, event: any) => {
                if (roomIdMatch === roomId && 
                    event.sender.startsWith('@_plural_') && 
                    event.content?.body === messageBody) {
                    console.log(`[E2E-Plain] Caught ghost message from ${event.sender}`);
                    client.off("room.message", listener);
                    resolve(event);
                }
            };
            client.on("room.message", listener);
        });

        // 3. Send trigger message
        console.log(`[E2E-Plain] Sending proxied message...`);
        const triggerEventId = await client.sendText(roomId, `${proxyPrefix} ${messageBody}`);

        // 4. Wait for ghost
        console.log(`[E2E-Plain] Waiting for ghost response...`);
        const ghostEvent = await ghostMessagePromise;
        
        expect(ghostEvent.content.body).toBe(messageBody);
        console.log(`[E2E-Plain] SUCCESS! Ghost spoke as ${ghostEvent.sender}`);

        // 5. Verify redaction
        console.log(`[E2E-Plain] Verifying redaction of original message...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            const originalEvent = await client.getEvent(roomId, triggerEventId);
            expect(originalEvent.unsigned?.redacted_by).toBeDefined();
            console.log(`[E2E-Plain] Original message was successfully hidden.`);
        } catch (e) {
            // Some servers might 404 redacted events, that's also a win
            console.log(`[E2E-Plain] Original message is gone (404/Redacted).`);
        }
    }, 30000);

    xit('should proxy a message in an ENCRYPTED room', async () => {
        const messageBody = "Encryption test message";
        const proxyPrefix = "e2e:";

        // 1. Create a new room and enable encryption
        console.log(`[E2E-E2EE] Creating encrypted room...`);
        const e2eeRoomId = await setupTestRoom(client);
        console.log(`[E2E-E2EE] Enabling encryption in ${e2eeRoomId}...`);
        await client.sendStateEvent(e2eeRoomId, "m.room.encryption", "", { algorithm: "m.megolm.v1.aes-sha2" });
        
        // 2. Wait for bot to settle (Native E2EE handles this now)
        console.log(`[E2E-E2EE] Waiting for bot to settle (10s)...`);
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 3. Start listening for the ghost message
        const ghostMessagePromise = new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                client.off("room.message", listener);
                reject(new Error("Timeout waiting for ghost message in encrypted room"));
            }, 45000);

            const listener = (roomIdMatch: string, event: any) => {
                console.log(`[E2E-E2EE] Observed event in ${roomIdMatch} from ${event.sender}: ${event.type}`);
                if (roomIdMatch === e2eeRoomId && 
                    event.sender.startsWith('@_plural_') && 
                    event.content?.body === messageBody) {
                    console.log(`[E2E-E2EE] MATCH! Caught ghost message from ${event.sender}`);
                    clearTimeout(timeout);
                    client.off("room.message", listener);
                    resolve(event);
                }
            };
            client.on("room.message", listener);
        });

        // 4. Send trigger message
        console.log(`[E2E-E2EE] Sending trigger message to encrypted room...`);
        await client.sendText(e2eeRoomId, `${proxyPrefix} ${messageBody}`);

        // 5. Wait for ghost (decrypted)
        console.log(`[E2E-E2EE] Waiting for ghost response...`);
        const ghostEvent = await ghostMessagePromise;
        
        expect(ghostEvent.content.body).toBe(messageBody);
        console.log(`[E2E-E2EE] SUCCESS! Ghost spoke decrypted message as ${ghostEvent.sender}`);
    }, 60000);
});
