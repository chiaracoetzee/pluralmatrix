import { Intent } from "matrix-appservice-bridge";
import { OlmMachineManager } from "./OlmMachineManager";
import { RoomId, UserId, EncryptionSettings, DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { processCryptoRequests, registerDevice, dispatchRequest } from "./crypto-utils";

/**
 * Manually dispatches to-device messages (like Megolm room keys) to Synapse.
 */
async function dispatchToDevice(intent: Intent, asToken: string, ghostUserId: string, req: any) {
    const hsUrl = intent.matrixClient.homeserverUrl.replace(/\/$/, "");
    const eventType = req.eventType || req.event_type;
    const txnId = req.txnId || req.txn_id;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.messages ? { messages: req.messages } : req);

    const url = new URL(`${hsUrl}/_matrix/client/v3/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(txnId)}`);
    url.searchParams.set("user_id", ghostUserId);

    const res = await fetch(url.toString(), {
        method: "PUT",
        headers: {
            'Authorization': `Bearer ${asToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`ToDevice dispatch failed: ${res.status} ${text}`);
    }
}

/**
 * Encrypts and sends a room event, ensuring that Megolm session keys 
 * are shared with all recipients before the message is dispatched.
 */
export async function sendEncryptedEvent(
    intent: Intent,
    roomId: string,
    eventType: string,
    content: any,
    manager: OlmMachineManager,
    asToken: string
) {
    const ghostUserId = intent.userId;

    // 1. Check if room is encrypted
    let isEncrypted = false;
    try {
        const encryptionState = await intent.matrixClient.getRoomStateEvent(roomId, "m.room.encryption", "");
        if (encryptionState && encryptionState.algorithm === "m.megolm.v1.aes-sha2") {
            isEncrypted = true;
        }
    } catch (e) {
        // Not encrypted
    }

    if (!isEncrypted) {
        return intent.sendEvent(roomId, eventType, content);
    }

    console.log(`[Crypto] Encrypting outbound message for ${ghostUserId} in ${roomId}`);

    try {
        const machine = await manager.getMachine(ghostUserId);

        // Ensure device is registered on HS (MSC3202 requirement)
        const isNewDevice = await registerDevice(intent, machine.deviceId.toString());

        // 2. Prepare recipients
        const members = await intent.matrixClient.getJoinedRoomMembers(roomId);
        const rustUserIds = members.map((m: string) => new UserId(m));
        const rustRoomId = new RoomId(roomId);

        console.log(`[Crypto] Step A: Discovery & Identity Phase...`);
        
        // UNIFIED DISCOVERY HACK: Force the SDK to recognize device list changes.
        // This is necessary because Appservice users don't receive /sync updates.
        const changedDevices = new DeviceLists(rustUserIds, []);
        await machine.receiveSyncChanges("[]", changedDevices, {}, []);
        await machine.updateTrackedUsers(rustUserIds);
        
        // Pass 1: Publish identity and handle background discovery (KeysQuery)
        await processCryptoRequests(machine, intent, asToken);
        
        if (isNewDevice) {
            console.log(`[Crypto]   - New ghost identity. Waiting for HS propagation (1s)...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Pass 2: CRITICAL - Explicitly execute the KeysClaimRequest for missing sessions
        console.log(`[Crypto]   - Ensuring Olm sessions exist for recipients...`);
        const missingSessionsReq = await machine.getMissingSessions(rustUserIds);
        if (missingSessionsReq) {
            console.log(`[Crypto]   - Found missing Olm sessions. Dispatching KeysClaim...`);
            await dispatchRequest(machine, intent, asToken, missingSessionsReq);
            // Drain any background discovery triggered by the claim
            await processCryptoRequests(machine, intent, asToken);
        }
        
        console.log(`[Crypto] Step B: Key Sharing Phase...`);
        const settings = new EncryptionSettings();
        settings.onlyAllowTrustedDevices = false;
        
        const shareRequests = await (machine as any).shareRoomKey(rustRoomId, rustUserIds, settings);

        if (shareRequests && shareRequests.length > 0) {
            console.log(`[Crypto]   - Sharing Megolm keys with ${shareRequests.length} payload(s)...`);
            for (const req of shareRequests) {
                try {
                    await dispatchToDevice(intent, asToken, ghostUserId, req);
                } catch (dispatchErr: any) {
                    console.error(`[Crypto]   - Failed to dispatch:`, dispatchErr.message);
                }
            }
        }

        // Pass 3: Final cleanup
        await processCryptoRequests(machine, intent, asToken);

        // 4. Finally encrypt
        console.log(`[Crypto] Step C: Encrypting event...`);
        const relatesTo = content["m.relates_to"];
        const contentToEncrypt = { ...content };
        
        const encryptedContentString = await machine.encryptRoomEvent(rustRoomId, eventType, JSON.stringify(contentToEncrypt));
        const encryptedPayload = JSON.parse(encryptedContentString);
        
        if (relatesTo) {
            encryptedPayload["m.relates_to"] = relatesTo;
        }
        
        console.log(`[Crypto] Step D: Sending encrypted event to ${roomId}`);
        return intent.sendEvent(roomId, "m.room.encrypted", encryptedPayload);

    } catch (e: any) {
        console.error(`[Crypto] Encryption failed for ${ghostUserId} in ${roomId}:`, e.message || e);
        throw e;
    }
}
