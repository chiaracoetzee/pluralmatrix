import { execSync } from 'child_process';
import { MatrixClient } from '@vector-im/matrix-bot-sdk';

const SYNAPSE_URL = "http://localhost:8008";
const APP_SERVICE_URL = "http://localhost:9000";

export const registerUser = (username: string, password: string): string => {
    console.log(`[E2E] Registering user ${username}...`);
    try {
        const cmd = `sudo docker exec plural-synapse register_new_matrix_user -c /data/homeserver.yaml -u ${username} -p ${password} --admin http://localhost:8008`;
        execSync(cmd, { stdio: 'pipe' });
        console.log(`[E2E] User ${username} registered successfully.`);
        return `@${username}:localhost`;
    } catch (e: any) {
        if (e.message.includes('User ID already taken')) {
            console.log(`[E2E] User ${username} already exists.`);
            return `@${username}:localhost`;
        }
        console.error(`[E2E] Registration failed for ${username}:`, e.message);
        throw e;
    }
};

export const getMatrixClient = async (username: string, password: string): Promise<MatrixClient> => {
    console.log(`[E2E] Logging in user ${username} to Matrix...`);
    const response = await fetch(`${SYNAPSE_URL}/_matrix/client/v3/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: username },
            password: password
        })
    });
    
    const data = await response.json() as any;
    if (!response.ok) {
        console.error(`[E2E] Matrix login failed for ${username}:`, JSON.stringify(data));
        throw new Error(`Login failed: ${JSON.stringify(data)}`);
    }
    
    console.log(`[E2E] User ${username} logged in to Matrix.`);
    return new MatrixClient(SYNAPSE_URL, data.access_token);
};

export const getPluralMatrixToken = async (mxid: string, password: string): Promise<string> => {
    console.log(`[E2E] Fetching PluralMatrix JWT for ${mxid}...`);
    const response = await fetch(`${APP_SERVICE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mxid, password })
    });
    
    const data = await response.json() as any;
    if (!response.ok) {
        console.error(`[E2E] PluralMatrix login failed for ${mxid}:`, JSON.stringify(data));
        throw new Error(`PluralMatrix login failed: ${JSON.stringify(data)}`);
    }
    
    console.log(`[E2E] PluralMatrix JWT obtained for ${mxid}.`);
    return data.token;
};

export const setupTestRoom = async (client: MatrixClient): Promise<string> => {
    console.log(`[E2E] Creating test room...`);
    const roomId = await client.createRoom({
        visibility: 'private',
        name: `E2E Test Room ${Date.now()}`,
        invite: ['@plural_bot:localhost']
    });
    console.log(`[E2E] Test room created: ${roomId}`);
    return roomId;
};
