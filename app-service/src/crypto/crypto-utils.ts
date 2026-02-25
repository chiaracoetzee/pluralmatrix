import { OlmMachine, RequestType, KeysUploadRequest, KeysQueryRequest, KeysClaimRequest, SignatureUploadRequest } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { Intent } from "matrix-appservice-bridge";

// In-memory cache to prevent redundant registrations/logins
const registeredDevices = new Set<string>();

// Helper to perform raw fetch using AS Token (MSC3202 style)
async function doAsRequest(
    hsUrl: string, 
    asToken: string, 
    targetUserId: string, 
    method: string, 
    path: string, 
    body: any,
    msc3202DeviceId?: string
) {
    const url = new URL(`${hsUrl}${path}`);
    url.searchParams.set("user_id", targetUserId);
    if (msc3202DeviceId) {
        url.searchParams.set("org.matrix.msc3202.device_id", msc3202DeviceId);
    }

    const headers = {
        'Authorization': `Bearer ${asToken}`,
        'Content-Type': 'application/json'
    };

    const res = await fetch(url.toString(), {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`[Crypto] Matrix API Error ${res.status}: ${text} (${method} ${url.toString()})`);
        
        const error: any = new Error(`Matrix API Error ${res.status}`);
        error.status = res.status;
        error.body = text;
        throw error;
    }
    return res.json();
}

/**
 * Ensures a device is registered on the homeserver.
 * Returns true if the device was newly registered in this session.
 */
export async function registerDevice(intent: Intent, deviceId: string): Promise<boolean> {
    const userId = intent.userId;
    const cacheKey = `${userId}|${deviceId}`;
    if (registeredDevices.has(cacheKey)) return false;

    console.log(`[Crypto] Registering/Verifying device ${deviceId} for ${userId}...`);
    try {
        await intent.matrixClient.doRequest("POST", "/_matrix/client/v3/login", null, {
            type: "m.login.application_service",
            identifier: {
                type: "m.id.user",
                user: userId 
            },
            device_id: deviceId,
            initial_device_display_name: "PluralMatrix (Native E2EE)"
        });
        console.log(`[Crypto] Device ${deviceId} registration verified.`);
        registeredDevices.add(cacheKey);
        return true;
    } catch (e: any) {
        if (e.message?.includes("M_LIMIT_EXCEEDED")) {
            console.warn(`[Crypto] Rate limited while registering device ${deviceId}.`);
            return false;
        }
        
        console.error(`[Crypto] Device registration call failed for ${userId}:`, e.message);
        registeredDevices.add(cacheKey);
        return false;
    }
}

/**
 * Dispatches a single cryptographic request to Synapse.
 */
export async function dispatchRequest(machine: OlmMachine, intent: Intent, asToken: string, req: any) {
    const userId = intent.userId;
    const hsUrl = intent.matrixClient.homeserverUrl.replace(/\/$/, "");
    const deviceId = machine.deviceId.toString();

    try {
        let response: any;

        switch (req.type) {
            case RequestType.KeysUpload:
                try {
                    response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/upload", JSON.parse(req.body), deviceId);
                } catch (err: any) {
                    if (err.body && err.body.includes("already exists")) {
                        response = { "one_time_key_counts": { "signed_curve25519": 50 } }; 
                    } else throw err;
                }
                break;

            case RequestType.KeysQuery:
                const queryBody = JSON.parse(req.body);
                response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/query", queryBody);
                const devCount = Object.keys(response.device_keys || {}).length;
                console.log(`[KEY_EXCHANGE] KeysQuery success for ${userId}. Found ${devCount} users.`);
                break;

            case RequestType.KeysClaim:
                const claimBody = JSON.parse(req.body);
                response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/claim", claimBody);
                const OTKCount = response.one_time_keys ? Object.keys(response.one_time_keys).length : 0;
                console.log(`[KEY_EXCHANGE] KeysClaim success for ${userId}. Obtained OTKs for ${OTKCount} users.`);
                break;
            
            case RequestType.SignatureUpload:
                response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/signatures/upload", JSON.parse(req.body));
                break;

            case RequestType.ToDevice:
                console.log(`[KEY_EXCHANGE] Sending ToDevice ${req.eventType} from ${userId}`);
                response = await doAsRequest(hsUrl, asToken, userId, "PUT", `/_matrix/client/v3/sendToDevice/${encodeURIComponent(req.eventType)}/${encodeURIComponent(req.txnId)}`, JSON.parse(req.body));
                break;

            default:
                console.warn(`[Crypto] Unknown request type: ${req.type}`);
                return;
        }
        
        await machine.markRequestAsSent(req.id, req.type, JSON.stringify(response));
    } catch (e: any) {
        console.error(`[KEY_EXCHANGE] ❌ FAILED request ${req.id} (Type ${req.type}) for ${userId}:`, e.message);
    }
}

export async function processCryptoRequests(machine: OlmMachine, intent: Intent, asToken: string) {
    let loopCount = 0;
    while (loopCount < 10) {
        const requests = await machine.outgoingRequests();
        if (requests.length === 0) break;
        for (const req of requests) {
            await dispatchRequest(machine, intent, asToken, req);
        }
        loopCount++;
    }
}
