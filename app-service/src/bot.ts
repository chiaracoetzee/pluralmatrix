import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, Intent, AppService } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { marked } from "marked";
import { proxyCache } from "./services/cache";
import { OlmMachineManager } from "./crypto/OlmMachineManager";
import { TransactionRouter } from "./crypto/TransactionRouter";
import { DeviceLists, UserId, RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { sendEncryptedEvent } from "./crypto/encryption";
import { processCryptoRequests, registerDevice } from "./crypto/crypto-utils";

// Initialize Prisma
export const prisma = new PrismaClient();
// Initialize Crypto Manager
export const cryptoManager = new OlmMachineManager();
// Store AS token for crypto requests
export let asToken: string;

/**
 * Sets the global Appservice token (Used for testing and initialization)
 */
export const setAsToken = (token: string) => {
    asToken = token;
};

// Helper to send plain text (Encrypted if needed)
const sendEncryptedText = async (intent: Intent, roomId: string, text: string) => {
    // Ensure bot device is registered before responding
    const botUserId = intent.userId;
    const machine = await cryptoManager.getMachine(botUserId);
    await registerDevice(intent, machine.deviceId.toString());

    return sendEncryptedEvent(intent, roomId, "m.room.message", {
        msgtype: "m.text",
        body: text
    }, cryptoManager, asToken);
};

// Helper to send formatted Markdown (Encrypted if needed)
const sendRichText = async (intent: Intent, roomId: string, text: string) => {
    // Ensure bot device is registered before responding
    const botUserId = intent.userId;
    const machine = await cryptoManager.getMachine(botUserId);
    await registerDevice(intent, machine.deviceId.toString());

    const html = await marked.parse(text, { breaks: true });
    return sendEncryptedEvent(intent, roomId, "m.room.message", {
        msgtype: "m.text",
        body: text,
        format: "org.matrix.custom.html",
        formatted_body: html.trim()
    }, cryptoManager, asToken);
};

const getRoomMessages = async (botClient: any, roomId: string, limit: number = 50) => {
    return botClient.doRequest("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
        limit,
        dir: 'b'
    });
};

/**
 * Robustly resolves a target ghost message, finding its root ID and latest text.
 * Handles both plaintext and encrypted messages, explicit reply targets, and chained edits.
 */
const resolveGhostMessage = async (bridgeInstance: Bridge, botClient: any, roomId: string, systemSlug: string, explicitTargetId?: string) => {
    const scrollback = await getRoomMessages(botClient, roomId, 50);
    const rustRoomId = new RoomId(roomId);

    let targetRoot: any = null;
    let latestContent: any = null;
    const ghostPrefix = `@_plural_${systemSlug}_`;

    let rootId = explicitTargetId;

    if (rootId) {
        // Resolve explicit target (replyTo)
        try {
            let explicitEvent: any = null;
            
            try {
                // First check if the target is already in our recent scrollback to avoid network/permission errors
                explicitEvent = scrollback.chunk.find((e: any) => e.event_id === rootId || e.id === rootId);
                if (!explicitEvent) {
                    // Try fetching specifically via API if not in scrollback
                    explicitEvent = await botClient.getEvent(roomId, rootId);
                }
            } catch (apiErr: any) {
                // API fetch failed, explicitEvent will be null
            }

            if (!explicitEvent) return null;
            
            // Handle both class instances (from botClient.getEvent) and raw JSON (from scrollback)
            const eventSender = explicitEvent.sender || (explicitEvent as any).sender;
            const eventType = explicitEvent.type || (explicitEvent as any).type;
            let content = explicitEvent.content || (explicitEvent as any).content || {};
            
            // Decrypt if encrypted to check for replacement metadata
            if (eventType === "m.room.encrypted") {
                try {
                    const senderMachine = await cryptoManager.getMachine(eventSender);
                    const decrypted = await senderMachine.decryptRoomEvent(JSON.stringify(explicitEvent), rustRoomId);
                    if (decrypted.event) {
                        content = JSON.parse(decrypted.event).content;
                    }
                } catch (err: any) {}
            }
            
            const rel = content["m.relates_to"];
            if (rel?.rel_type === "m.replace") {
                rootId = rel.event_id || rel.id;
            }
            
            targetRoot = { ...explicitEvent, sender: eventSender, type: eventType, content };
            latestContent = content;
            if (!eventSender || !eventSender.startsWith(ghostPrefix)) return null;
        } catch (e: any) {
            return null;
        }
    } else {
        // Find the latest ROOT message in scrollback
        for (const e of scrollback.chunk) {
            if (e.unsigned?.redacted_by) continue;
            if (!e.sender.startsWith(ghostPrefix)) continue;

            const isEncrypted = e.type === "m.room.encrypted";
            const isPlainMessage = e.type === "m.room.message";
            if (!isEncrypted && !isPlainMessage) continue;

            let content = e.content || {};
            const rel = content["m.relates_to"] || {};
            const isReplacement = rel.rel_type === "m.replace";

            if (!isReplacement) {
                targetRoot = e;
                if (isEncrypted) {
                    try {
                        const senderMachine = await cryptoManager.getMachine(e.sender);
                        const decrypted = await senderMachine.decryptRoomEvent(JSON.stringify(e), rustRoomId);
                        if (decrypted.event) {
                            content = JSON.parse(decrypted.event).content;
                        }
                    } catch (err) {}
                }
                latestContent = content;
                rootId = e.event_id || e.id;
                break;
            }
        }
    }

    if (!targetRoot || !rootId) return null;

    // 2. Best Effort: Find LATEST edit of this root in scrollback
    for (const e of scrollback.chunk) {
        if (e.unsigned?.redacted_by) continue;
        if (e.sender !== targetRoot.sender) continue;

        let content = e.content || {};
        const rel = content["m.relates_to"] || {};
        
        // If this is an edit of our root
        if (rel.rel_type === "m.replace" && (rel.event_id === rootId || rel.id === rootId)) {
            // Decrypt using the SENDER's machine (same ghost as root)
            if (e.type === "m.room.encrypted") {
                try {
                    const senderMachine = await cryptoManager.getMachine(e.sender);
                    const decrypted = await senderMachine.decryptRoomEvent(JSON.stringify(e), rustRoomId);
                    if (decrypted.event) {
                        content = JSON.parse(decrypted.event).content;
                    }
                } catch (err) {}
            }
            latestContent = content;
            break;
        }
    }

    return { 
        event: targetRoot, 
        latestContent,
        originalId: rootId
    };
};

// Configuration
const REGISTRATION_PATH = "/data/app-service-registration.yaml";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://localhost:8008";
const DOMAIN = process.env.SYNAPSE_SERVER_NAME || process.env.SYNAPSE_DOMAIN || "localhost";

// Placeholder for the bridge instance
let bridge: Bridge;

// Track rooms where we've already warned about missing permissions
const permissionWarnedRooms = new Set<string>();

/**
 * Safely redacts an event, attempting to use the best intent possible.
 */
const safeRedact = async (bridgeInstance: Bridge, roomId: string, eventId: string, reason: string, preferredIntent?: Intent) => {
    const intent = preferredIntent || bridgeInstance.getIntent();
    try {
        await (intent as any).matrixClient.redactEvent(roomId, eventId, reason);
    } catch (e: any) {
        if (e.errcode === 'M_FORBIDDEN' || e.httpStatus === 403) {
            try {
                // Fallback to bot intent if ghost lacked permissions
                await (bridgeInstance.getIntent() as any).matrixClient.redactEvent(roomId, eventId, reason);
            } catch (fallbackErr: any) {
                if ((fallbackErr.errcode === 'M_FORBIDDEN' || fallbackErr.httpStatus === 403) && !permissionWarnedRooms.has(roomId)) {
                    console.warn(`[Bot] Lacking redaction permissions in ${roomId}.`);
                    await sendEncryptedText(bridgeInstance.getIntent(), roomId, 
                        "⚠️ I don't have permission to redact (delete) messages in this room. " +
                        "To enable high-fidelity proxying and 'Zero-Flash' cleanup, please promote me to Moderator or give me 'Redact events' permissions."
                    );
                    permissionWarnedRooms.add(roomId);
                }
            }
        } else {
            console.error(`[Janitor] Failed to redact message ${eventId}:`, e.message || e);
        }
    }
};

export const handleEvent = async (request: Request<WeakEvent>, context: BridgeContext | undefined, bridgeInstance: Bridge, prismaClient: PrismaClient, isDecrypted: boolean = false, asTokenArg?: string) => {
    const currentAsToken = asTokenArg || asToken;
    const event = request.getData();
    const eventId = event.event_id!;
    const roomId = event.room_id!;
    const sender = event.sender;
    
    // Auto-accept invites
    if (event.type === "m.room.member" && event.state_key === bridgeInstance.getBot().getUserId() && event.content.membership === "invite") {
        console.log(`[Bot] Received invite to ${roomId}. Joining...`);
        await bridgeInstance.getIntent().join(roomId);
        return;
    }

    // Reaction deletion logic
    if (event.type === "m.reaction") {
        const relatesTo = event.content?.["m.relates_to"] as any;
        if (relatesTo?.rel_type === "m.annotation") {
            const reaction = relatesTo.key;
            if (reaction?.startsWith("❌") || reaction === "x" || reaction === ":x:") {
                const targetEventId = relatesTo.event_id;
                const system = await proxyCache.getSystemRules(sender, prismaClient);
                if (!system) return;

                try {
                    const targetEvent = await (bridgeInstance.getBot().getClient() as any).getEvent(roomId, targetEventId);
                    if (targetEvent && targetEvent.sender.startsWith(`@_plural_${system.slug}_`)) {
                        console.log(`[Janitor] Deleting message ${targetEventId} via reaction from ${sender}`);
                        await safeRedact(bridgeInstance, roomId, targetEventId, "UserRequest", bridgeInstance.getIntent(targetEvent.sender));
                        await safeRedact(bridgeInstance, roomId, eventId, "Cleanup");
                    }
                } catch (e: any) {
                    console.error(`[Janitor] Error handling reaction deletion:`, e.message);
                }
            }
        }
        return;
    }

    // Ignore raw encrypted events pushed via AS (The router handles them locally)
    if (event.type === "m.room.encrypted" && !isDecrypted) return;

    if (event.type !== "m.room.message" && !isDecrypted) return;
    
    const content = event.content as any;
    if (!content) return;

    let body = content.body as string; 
    let isEdit = false;
    let originalEventId = eventId;

    if (content["m.new_content"] && content["m.relates_to"]?.rel_type === "m.replace") {
        body = content["m.new_content"].body;
        isEdit = true;
        originalEventId = content["m.relates_to"].event_id;
    }

    if (body === undefined || body === null) return;

    const botUserId = bridgeInstance.getBot().getUserId();
    if (sender === botUserId || sender.startsWith("@_plural_")) return;

    // Edit Loop Prevention
    if (isEdit) {
        try {
            const originalEvent = await (bridgeInstance.getBot().getClient() as any).getEvent(roomId, originalEventId);
            const redactedBy = originalEvent?.unsigned?.redacted_by;
            if (redactedBy === botUserId || redactedBy?.startsWith("@_plural_")) return;
        } catch (e) { }
    }

    // --- ZERO-FLASH: REDACT EMPTY MESSAGES (MOD-CLEARED) ---
    if (body.trim() === "") {
        console.log(`[Janitor] Redacting module-cleared message ${eventId} in ${roomId}`);
        await safeRedact(bridgeInstance, roomId, eventId, "ZeroFlash");
        return;
    }

    // --- Command handling ---
    if (body.startsWith("pk;")) {
        const parts = body.split(" ");
        const cmd = parts[0].substring(3).toLowerCase();

        if (cmd === "list") {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system || system.members.length === 0) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, "You don't have any alters registered yet.");
                return;
            }
            const sortedMembers = system.members.sort((a, b) => a.slug.localeCompare(b.slug));
            const memberList = sortedMembers.map(m => {
                const tags = m.proxyTags as any[];
                const tag = tags[0];
                const display = tag ? `\`${tag.prefix}text${tag.suffix}\`` : "None";
                return `* **${m.name}** - ${display} (id: \`${m.slug}\`)`;
            }).join("\n");
            await sendRichText(bridgeInstance.getIntent(), roomId, `### ${system.name || "Your System"} Members\n${memberList}`);
            return;
        }

        if (cmd === "member" && parts[1]) {
            const slug = parts[1].toLowerCase();
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            const member = system?.members.find(m => m.slug === slug);
            if (!member) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, `No member found with ID: ${slug}`);
                return;
            }
            let info = `## Member Details: ${member.name}\n\n`;
            if (member.pronouns) info += `* **Pronouns:** ${member.pronouns}\n`;
            if (member.color) info += `* **Color:** \`#${member.color}\`\n`;
            if (member.description) info += `\n### Description\n${member.description}\n\n`;
            const tags = (member.proxyTags as any[]).map(t => `\`${t.prefix}text${t.suffix}\``).join(", ");
            info += `--- \n* **Proxy Tags:** ${tags || "None"}`;
            await sendRichText(bridgeInstance.getIntent(), roomId, info);
            return;
        }

        // --- Targeting logic for Edit/Reproxy/Delete ---
        if (["edit", "e", "reproxy", "rp", "message", "msg", "m"].includes(cmd)) {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system) return;

            let targetId: string | undefined;
            let targetSender: string | undefined;
            let targetContent: any;
            let originalId: string | undefined;

            const relatesTo = (event.content as any)?.["m.relates_to"];
            const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

            const resolution = await resolveGhostMessage(bridgeInstance, bridgeInstance.getBot().getClient(), roomId, system.slug, replyTo);
            
            if (resolution) {
                targetSender = resolution.event.sender;
                targetContent = resolution.latestContent;
                targetId = resolution.event.event_id || resolution.event.id;
                originalId = resolution.originalId;
            }

            if (!targetId || !targetSender || !targetContent || !originalId) {
                if (cmd !== "message" && cmd !== "msg" && cmd !== "m") {
                    await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Could not find a proxied message to modify.");
                }
                return;
            }

            // Extract text correctly (plaintext body)
            const latestText = targetContent["m.new_content"]?.body || targetContent.body;

            if (cmd === "edit" || cmd === "e") {
                const newText = parts.slice(1).join(" ");
                if (!newText) return;
                const editPayload = {
                    msgtype: "m.text", body: ` * ${newText}`,
                    "m.new_content": { msgtype: "m.text", body: newText },
                    "m.relates_to": { rel_type: "m.replace", event_id: originalId }
                };
                await sendEncryptedEvent(bridgeInstance.getIntent(targetSender), roomId, "m.room.message", editPayload, cryptoManager, currentAsToken);
            } else if (cmd === "reproxy" || cmd === "rp") {
                const memberSlug = parts[1]?.toLowerCase();
                const member = system.members.find(m => m.slug === memberSlug);
                if (member) {
                    const latestText = targetContent["m.new_content"]?.body || targetContent.body;

                    if (!latestText) {
                        await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Could not extract the message text to reproxy. This usually happens if the bot can't decrypt the original message.");
                        return;
                    }

                    // Reproxy: Redact old root and send new from new ghost
                    await safeRedact(bridgeInstance, roomId, originalId, "PluralReproxy", bridgeInstance.getIntent(targetSender));
                    
                    const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                    const intent = bridgeInstance.getIntent(ghostUserId);
                    const finalDisplayName = system.systemTag ? `${member.displayName || member.name} ${system.systemTag}` : (member.displayName || member.name);
                    
                    await intent.ensureRegistered();
                    await intent.join(roomId);
                    await intent.setDisplayName(finalDisplayName);
                    if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                    
                    await sendEncryptedEvent(intent, roomId, "m.room.message", { msgtype: "m.text", body: latestText }, cryptoManager, currentAsToken);
                }
            } else {
                const subCmd = parts[1]?.toLowerCase();
                if (subCmd === "-delete" || subCmd === "-d") {
                    await safeRedact(bridgeInstance, roomId, originalId, "UserRequest", bridgeInstance.getIntent(targetSender));
                }
            }

            await safeRedact(bridgeInstance, roomId, eventId, "PluralCommand");
            return;
        }
    }
    
    // --- Janitor Logic (Proxying) ---
    const system = await proxyCache.getSystemRules(sender, prismaClient);
    if (!system) return;

    for (const member of system.members) {
        const tags = member.proxyTags as any[];
        for (const tag of tags) {
            if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                if (!cleanContent) return;

                console.log(`[Janitor] Proxying for ${member.name} in ${roomId}`);
                
                await safeRedact(bridgeInstance, roomId, eventId, "PluralProxy");
                if (isEdit && originalEventId !== eventId) {
                    await safeRedact(bridgeInstance, roomId, originalEventId, "PluralProxyOriginal");
                }
                
                try {
                    const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                    const intent = bridgeInstance.getIntent(ghostUserId);
                    const finalDisplayName = system.systemTag ? `${member.displayName || member.name} ${system.systemTag}` : (member.displayName || member.name);

                    await intent.ensureRegistered();
                    try { await intent.join(roomId); } catch (e) {
                        try { await bridgeInstance.getIntent().invite(roomId, ghostUserId); await intent.join(roomId); } catch (e2) {}
                    }

                    // Ensure ghost device is registered
                    const machine = await cryptoManager.getMachine(ghostUserId);
                    await registerDevice(intent, machine.deviceId.toString());

                    try { await intent.setDisplayName(finalDisplayName); if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl); } catch (e) {}

                    const payload: any = { msgtype: "m.text", body: cleanContent };
                    if (event.content["m.relates_to"]) {
                        const relatesTo = { ...event.content["m.relates_to"] } as any;
                        if (relatesTo.rel_type === "m.replace") { delete relatesTo.rel_type; delete relatesTo.event_id; }
                        if (Object.keys(relatesTo).length > 0) payload["m.relates_to"] = relatesTo;
                    }

                    await sendEncryptedEvent(intent, roomId, "m.room.message", payload, cryptoManager, currentAsToken);
                } catch (e) {}
                return;
            }
        }
    }
};

export const startMatrixBot = async () => {
    const reg = yaml.load(fs.readFileSync(REGISTRATION_PATH, 'utf8')) as AppServiceRegistration;
    asToken = (reg as any).as_token;

    bridge = new Bridge({
        homeserverUrl: HOMESERVER_URL,
        domain: DOMAIN,
        registration: REGISTRATION_PATH,
        roomStore: "./data/room-store.db",
        userStore: "./data/user-store.db",
        userActivityStore: "./data/user-activity-store.db",
        intentOptions: { clients: { dontCheckPowerLevel: true } },
        controller: {
            onUserQuery: () => ({}),
            onEvent: async (request: Request<WeakEvent>) => { await handleEvent(request, undefined, bridge, prisma); }
        }
    });

    console.log("Starting Matrix Bridge...");
    await bridge.initialise();

    const botUserId = bridge.getBot().getUserId();
    
    // Setup Transaction Interception for E2EE
    const router = new TransactionRouter(cryptoManager, botUserId, 
        async (userId) => {
            const machine = await cryptoManager.getMachine(userId);
            const intent = bridge.getIntent(userId);
            await registerDevice(intent, machine.deviceId.toString());
            await processCryptoRequests(machine, intent, asToken);
        },
        async (decryptedEvent) => {
            await handleEvent({ getData: () => decryptedEvent } as any, undefined, bridge, prisma, true, asToken);
        }
    );

    // Initial Key Upload for Bot (MSC3202)
    console.log("[Crypto] Performing initial identity sync for Bot...");
    const botMachine = await cryptoManager.getMachine(botUserId);
    const botIntent = bridge.getIntent(botUserId);
    await registerDevice(botIntent, botMachine.deviceId.toString());
    await botMachine.receiveSyncChanges("[]", new DeviceLists(), {}, []);
    await processCryptoRequests(botMachine, botIntent, asToken);

    // Hook middleware into Express
    const appServiceInstance = new AppService({ homeserverToken: (reg as any).hs_token });
    const app = appServiceInstance.app as any;
    app.use(async (req: any, res: any, next: any) => {
        if (req.method === 'PUT' && req.path.includes('/transactions/')) {
            try { await router.processTransaction(req.body); } catch (e) { console.error("[Router] Error:", e); }
        }
        next();
    });

    if (app._router?.stack) {
        const stack = app._router.stack;
        const myLayer = stack.pop();
        const insertionIndex = stack.findIndex((l: any) => l.route);
        if (insertionIndex !== -1) stack.splice(insertionIndex, 0, myLayer);
        else stack.unshift(myLayer);
    }

    await bridge.listen(8008, "0.0.0.0", 10, appServiceInstance);
    await joinPendingInvites(bridge);
};

const joinPendingInvites = async (bridgeInstance: Bridge) => {
    try {
        const botClient = bridgeInstance.getBot().getClient();
        const syncData = await botClient.doRequest("GET", "/_matrix/client/v3/sync", { filter: '{"room":{"timeline":{"limit":1}}}' });
        if (syncData.rooms?.invite) {
            for (const roomId of Object.keys(syncData.rooms.invite)) {
                try { await bridgeInstance.getIntent().join(roomId); } catch (e) {}
            }
        }
    } catch (e) {}
};

export const getBridge = () => bridge;
