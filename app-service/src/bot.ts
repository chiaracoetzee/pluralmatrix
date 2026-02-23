import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, Intent } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { marked } from "marked";
import { proxyCache } from "./services/cache";
import { decrypterService } from "./services/decrypterService";

// Initialize Prisma
export const prisma = new PrismaClient();

// Helper to send formatted Markdown
const sendRichText = async (intent: Intent, roomId: string, text: string) => {
    const html = await marked.parse(text, { breaks: true });
    return intent.sendEvent(roomId, "m.room.message", {
        msgtype: "m.text",
        body: text,
        format: "org.matrix.custom.html",
        formatted_body: html.trim()
    });
};

const getRoomMessages = async (botClient: any, roomId: string, limit: number = 50) => {
    return botClient.doRequest("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
        limit,
        dir: 'b'
    });
};

// Configuration
const REGISTRATION_PATH = "/data/app-service-registration.yaml";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://localhost:8008";
const DOMAIN = process.env.SYNAPSE_SERVER_NAME || process.env.SYNAPSE_DOMAIN || "localhost";
const DECRYPTER_ID = `@plural_decrypter:${DOMAIN}`;

// Placeholder for the bridge instance
let bridge: Bridge;

// Track rooms where we've already warned about missing permissions
const permissionWarnedRooms = new Set<string>();
// Track rooms where we've already invited the decrypter
const roomsWithDecrypter = new Set<string>();

const safeRedact = async (bridgeInstance: Bridge, roomId: string, eventId: string, reason: string) => {
    try {
        await bridgeInstance.getBot().getClient().redactEvent(roomId, eventId, reason);
    } catch (e: any) {
        if (e.errcode === 'M_FORBIDDEN' || e.httpStatus === 403) {
            if (!permissionWarnedRooms.has(roomId)) {
                console.warn(`[Bot] Lacking redaction permissions in ${roomId}. Warning the room...`);
                await bridgeInstance.getIntent().sendText(roomId, 
                    "⚠️ I don't have permission to redact (delete) messages in this room. " +
                    "To enable high-fidelity proxying and 'Zero-Flash' cleanup, please promote me to a Moderator or give me 'Redact events' permissions."
                );
                permissionWarnedRooms.add(roomId);
            }
        } else {
            console.error(`[Janitor] Failed to redact message ${eventId}:`, e.message || e);
        }
    }
};

export const handleEvent = async (request: Request<WeakEvent>, context: BridgeContext | undefined, bridgeInstance: Bridge, prismaClient: PrismaClient) => {
    const event = request.getData();
    const eventId = event.event_id;
    
    // Auto-accept invites
    if (event.type === "m.room.member" && event.state_key === bridgeInstance.getBot().getUserId() && event.content.membership === "invite") {
        console.log(`[Bot] Received invite to ${event.room_id}. Joining...`);
        await bridgeInstance.getIntent().join(event.room_id);
        return;
    }

    // --- DECRYPTER STATE TRACKING ---
    // If the decrypter leaves or is kicked, clear it from our "invited" cache
    if (event.type === "m.room.member" && event.state_key === DECRYPTER_ID) {
        if (event.content.membership !== "join") {
            console.log(`[Bot] Decrypter ghost left/was removed from ${event.room_id}. Clearing cache.`);
            roomsWithDecrypter.delete(event.room_id);
        } else {
            roomsWithDecrypter.add(event.room_id);
        }
    }

    // Ignore encrypted events pushed via AS (The decrypter sidecar will catch them decrypted)
    if (event.type === "m.room.encrypted") {
        if (!roomsWithDecrypter.has(event.room_id)) {
            try {
                // Check if already in the room
                const botClient = bridgeInstance.getBot().getClient();
                const members = await botClient.getJoinedRoomMembers(event.room_id);
                if (members.includes(DECRYPTER_ID)) {
                    roomsWithDecrypter.add(event.room_id);
                    return;
                }

                console.log(`[Bot] Encryption detected in ${event.room_id}. Inviting Decrypter Ghost...`);
                await bridgeInstance.getIntent().invite(event.room_id, DECRYPTER_ID);
                roomsWithDecrypter.add(event.room_id);
            } catch (e: any) {
                // If we fail to get members (e.g. not in room), just try the invite
                try {
                    await bridgeInstance.getIntent().invite(event.room_id, DECRYPTER_ID);
                    roomsWithDecrypter.add(event.room_id);
                } catch (inviteErr: any) {
                    if (inviteErr.message?.includes("already in the room")) {
                        roomsWithDecrypter.add(event.room_id);
                    } else {
                        console.warn(`[Bot] Failed to invite decrypter to ${event.room_id}:`, inviteErr.message);
                    }
                }
            }
        }
        return;
    }

    if (event.type !== "m.room.message" || !event.content || event.content.body === undefined) return;
    
    const body = event.content.body as string; 
    const sender = event.sender;
    const roomId = event.room_id;

    // Loop prevention: Ignore the bot, the decrypter sidecar, and ghosts
    const botUserId = bridgeInstance.getBot().getUserId();
    if (sender === botUserId || sender === DECRYPTER_ID || sender.startsWith("@_plural_")) return;

    // --- EMPTY MESSAGE REDACTION ---
    if (body.trim() === "") {
        console.log(`[Janitor] Redacting empty message ${eventId} in ${roomId}`);
        await safeRedact(bridgeInstance, roomId, eventId, "EmptyBody");
        return;
    }

    // --- CHAT COMMANDS ---
    if (body.startsWith("pk;")) {
        const parts = body.split(" ");
        const cmd = parts[0].substring(3).toLowerCase();

        // 1. pk;list - List all alters
        if (cmd === "list") {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system || system.members.length === 0) {
                await bridgeInstance.getIntent().sendText(roomId, "You don't have any alters registered yet.");
                return;
            }
            const sortedMembers = system.members.sort((a, b) => a.slug.localeCompare(b.slug));
            const memberList = sortedMembers.map(m => {
                const tags = m.proxyTags as any[];
                const primaryPrefix = tags.find(t => t.prefix)?.prefix || "None";
                return `* **${m.name}** - \`${primaryPrefix}\` (id: \`${m.slug}\`)`;
            }).join("\n");
            await sendRichText(bridgeInstance.getIntent(), roomId, `### ${system.name || "Your System"} Members\n${memberList}`);
            return;
        }

        // 2. pk;member <slug> - Show details
        if (cmd === "member" && parts[1]) {
            const slug = parts[1].toLowerCase();
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            const member = system?.members.find(m => m.slug === slug);
            
            if (!member) {
                await bridgeInstance.getIntent().sendText(roomId, `No member found with ID: ${slug}`);
                return;
            }
            
            let info = `## Member Details: ${member.name}\n\n`;
            if (member.pronouns) info += `* **Pronouns:** ${member.pronouns}\n`;
            if (member.color) info += `* **Color:** \`#${member.color}\`\n`;
            if (member.description) info += `\n### Description\n${member.description}\n\n`;
            
            const tags = (member.proxyTags as any[]).map(t => `\`${t.prefix}text\``).join(", ");
            info += `--- \n* **Proxy Tags:** ${tags || "None"}`;

            await sendRichText(bridgeInstance.getIntent(), roomId, info);
            return;
        }

        // 3. pk;edit <text> - Edit last message or replied message
        if (cmd === "edit" || cmd === "e") {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system) return;

            const newText = parts.slice(1).join(" ");
            if (!newText) return;

            let targetEvent: any;
            const relatesTo = event.content["m.relates_to"] as any;
            const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

            if (replyTo) {
                try {
                    targetEvent = await bridgeInstance.getBot().getClient().getEvent(roomId, replyTo);
                    if (targetEvent && !targetEvent.event_id) {
                         targetEvent.event_id = replyTo;
                    }
                } catch (e: any) {
                    console.error(`[Edit] Failed to fetch replied-to event:`, e.message);
                }
            } else {
                const botClient = bridgeInstance.getBot().getClient();
                const scrollback = await getRoomMessages(botClient, roomId, 50);
                // Find the LATEST top-level event (not an edit) from this system
                targetEvent = scrollback.chunk.find((e: any) => 
                    e.type === "m.room.message" && 
                    e.sender.startsWith(`@_plural_${system.slug}_`) &&
                    e.content?.["m.relates_to"]?.rel_type !== "m.replace"
                );

                if (targetEvent) {
                    targetEvent.original_event_id = targetEvent.event_id;
                    // Now find the latest edit of THIS specific event in the scrollback
                    const latestEdit = scrollback.chunk.find((e: any) => 
                        e.type === "m.room.message" &&
                        e.content?.["m.relates_to"]?.rel_type === "m.replace" &&
                        e.content?.["m.relates_to"]?.event_id === targetEvent.event_id
                    );
                    targetEvent.latestText = latestEdit?.content?.["m.new_content"]?.body || targetEvent.content?.body;
                }
            }

            if (targetEvent) {
                // Handle resolution for both search and reply-to cases
                const content = targetEvent.content || {};
                
                // If we haven't already resolved latestText via the search above, do it now (for replies)
                if (!targetEvent.latestText) {
                    targetEvent.latestText = content["m.new_content"]?.body || content.body;
                }

                // If we haven't already resolved original_event_id, do it now
                if (!targetEvent.original_event_id) {
                    const relatesTo = content["m.relates_to"];
                    if (relatesTo?.rel_type === "m.replace" && relatesTo?.event_id) {
                        targetEvent.original_event_id = relatesTo.event_id;
                    } else {
                        targetEvent.original_event_id = targetEvent.event_id;
                    }
                }
            }

            if (!targetEvent || !targetEvent.sender.startsWith(`@_plural_${system.slug}_`)) {
                await bridgeInstance.getIntent().sendText(roomId, "Could not find a proxied message to edit.");
                return;
            }

            const ghostIntent = bridgeInstance.getIntent(targetEvent.sender);
            
            const editPayload = {
                msgtype: "m.text",
                body: ` * ${newText}`,
                "m.new_content": {
                    msgtype: "m.text",
                    body: newText
                },
                "m.relates_to": {
                    rel_type: "m.replace",
                    event_id: targetEvent.original_event_id
                }
            };

            await ghostIntent.sendEvent(roomId, "m.room.message", editPayload);
            
            await safeRedact(bridgeInstance, roomId, eventId, "PluralCommand");
            return;
        }

        // 4. pk;reproxy <slug> - Change the member of a proxied message
        if (cmd === "reproxy" || cmd === "rp") {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system) return;

            const memberSlug = parts[1]?.toLowerCase();
            const member = system.members.find(m => m.slug === memberSlug);
            if (!member) {
                await bridgeInstance.getIntent().sendText(roomId, `No member found with ID: ${memberSlug}`);
                return;
            }

            let targetEvent: any;
            const relatesTo = event.content["m.relates_to"] as any;
            const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

            if (replyTo) {
                try {
                    targetEvent = await bridgeInstance.getBot().getClient().getEvent(roomId, replyTo);
                    if (targetEvent && !targetEvent.event_id) {
                         targetEvent.event_id = replyTo;
                    }
                } catch (e: any) {
                    console.error(`[Edit] Failed to fetch replied-to event:`, e.message);
                }
            } else {
                const botClient = bridgeInstance.getBot().getClient();
                const scrollback = await getRoomMessages(botClient, roomId, 50);
                // Find the LATEST top-level event (not an edit) from this system
                targetEvent = scrollback.chunk.find((e: any) => 
                    e.type === "m.room.message" && 
                    e.sender.startsWith(`@_plural_${system.slug}_`) &&
                    e.content?.["m.relates_to"]?.rel_type !== "m.replace"
                );

                if (targetEvent) {
                    targetEvent.original_event_id = targetEvent.event_id;
                    // Now find the latest edit of THIS specific event in the scrollback
                    const latestEdit = scrollback.chunk.find((e: any) => 
                        e.type === "m.room.message" &&
                        e.content?.["m.relates_to"]?.rel_type === "m.replace" &&
                        e.content?.["m.relates_to"]?.event_id === targetEvent.event_id
                    );
                    targetEvent.latestText = latestEdit?.content?.["m.new_content"]?.body || targetEvent.content?.body;
                }
            }

            if (targetEvent) {
                // Handle resolution for both search and reply-to cases
                const content = targetEvent.content || {};
                
                // If we haven't already resolved latestText via the search above, do it now (for replies)
                if (!targetEvent.latestText) {
                    targetEvent.latestText = content["m.new_content"]?.body || content.body;
                }

                // If we haven't already resolved original_event_id, do it now
                if (!targetEvent.original_event_id) {
                    const relatesTo = content["m.relates_to"];
                    if (relatesTo?.rel_type === "m.replace" && relatesTo?.event_id) {
                        targetEvent.original_event_id = relatesTo.event_id;
                    } else {
                        targetEvent.original_event_id = targetEvent.event_id;
                    }
                }
            }

            if (!targetEvent || !targetEvent.sender.startsWith(`@_plural_${system.slug}_`)) {
                await bridgeInstance.getIntent().sendText(roomId, "Could not find a proxied message to reproxy.");
                return;
            }

            const oldText = targetEvent.latestText;

            // Delete original message
            await safeRedact(bridgeInstance, roomId, targetEvent.original_event_id, "PluralReproxy");

            // Send new message from correct ghost
            const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
            const intent = bridgeInstance.getIntent(ghostUserId);
            
            const finalDisplayName = system.systemTag 
                ? `${member.displayName || member.name} ${system.systemTag}`
                : (member.displayName || member.name);

            await intent.ensureRegistered();
            await intent.join(roomId);
            await intent.setDisplayName(finalDisplayName);
            if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);

            await intent.sendEvent(roomId, "m.room.message", {
                msgtype: "m.text",
                body: oldText
            });

            await safeRedact(bridgeInstance, roomId, eventId, "PluralCommand");
            return;
        }
    }
    
    // --- JANITOR LOGIC ---
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

                try {
                    const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                    const intent = bridgeInstance.getIntent(ghostUserId);
                    
                    const finalDisplayName = system.systemTag 
                        ? `${member.displayName || member.name} ${system.systemTag}`
                        : (member.displayName || member.name);

                    try {
                        await intent.join(roomId);
                    } catch (joinError) {
                        try {
                            await bridgeInstance.getIntent().invite(roomId, ghostUserId);
                            await intent.join(roomId);
                        } catch (e) {}
                    }

                    try {
                        await intent.setDisplayName(finalDisplayName);
                        if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                    } catch (e) {}

                    // --- PRESERVE RELATIONS (REPLIES) ---
                    const content: any = {
                        msgtype: "m.text",
                        body: cleanContent
                    };

                    if (event.content["m.relates_to"]) {
                        content["m.relates_to"] = event.content["m.relates_to"];
                    }

                    await intent.sendEvent(roomId, "m.room.message", content);
                } catch (e) {}
                
                return;
            }
        }
    }
};

export const startMatrixBot = async () => {
    // 1. Load Registration
    const reg = yaml.load(fs.readFileSync(REGISTRATION_PATH, 'utf8')) as AppServiceRegistration;

    // 2. Initialize Bridge
    bridge = new Bridge({
        homeserverUrl: HOMESERVER_URL,
        domain: DOMAIN,
        registration: REGISTRATION_PATH,
        intentOptions: {
            clients: { 
                dontCheckPowerLevel: true
            }
        },
        controller: {
            onUserQuery: function (queriedUser: any) {
                return {}; // Auto-create users
            },
            onEvent: async function (request: Request<WeakEvent>, context?: BridgeContext) {
                await handleEvent(request, context, bridge, prisma);
            }
        }
    });

    console.log("Starting Matrix Bridge...");
    await bridge.run(8008); 

    // 3. Start Decrypter Sidecar
    await decrypterService.start();

    // 4. Cleanup: Join any missed invitations while we were offline
    await joinPendingInvites(bridge);
};

const joinPendingInvites = async (bridgeInstance: Bridge) => {
    console.log("[Bot] Checking for pending invitations...");
    try {
        const botClient = bridgeInstance.getBot().getClient();
        
        // We do a minimal initial sync to find current invitations
        const syncData = await botClient.doRequest("GET", "/_matrix/client/v3/sync", {
            filter: '{"room":{"timeline":{"limit":1}}}'
        });

        if (syncData.rooms?.invite) {
            const inviteRoomIds = Object.keys(syncData.rooms.invite);
            if (inviteRoomIds.length > 0) {
                console.log(`[Bot] Found ${inviteRoomIds.length} pending invitations. Joining...`);
                for (const roomId of inviteRoomIds) {
                    try {
                        await bridgeInstance.getIntent().join(roomId);
                        console.log(`[Bot] Successfully joined ${roomId}`);
                    } catch (joinErr: any) {
                        console.error(`[Bot] Failed to join ${roomId}:`, joinErr.message);
                    }
                }
            } else {
                console.log("[Bot] No pending invitations found.");
            }
        }
    } catch (e: any) {
        console.warn("[Bot] Failed to sweep invites:", e.message);
    }
};

export const getBridge = () => bridge;
