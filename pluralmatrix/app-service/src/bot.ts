import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import * as yaml from "js-yaml";
import * as fs from "fs";

// Initialize Prisma
export const prisma = new PrismaClient();

// Configuration
const REGISTRATION_PATH = "/data/app-service-registration.yaml";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://localhost:8008";
const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";

// Placeholder for the bridge instance
let bridge: Bridge;

export const startMatrixBot = async () => {
    // 1. Load Registration
    const reg = yaml.load(fs.readFileSync(REGISTRATION_PATH, 'utf8')) as AppServiceRegistration;

    // 2. Initialize Bridge
    bridge = new Bridge({
        homeserverUrl: HOMESERVER_URL,
        domain: DOMAIN,
        registration: REGISTRATION_PATH,
        controller: {
            onUserQuery: function (queriedUser) {
                return {}; // Auto-create users
            },
            onEvent: async function (request: Request<WeakEvent>, context?: BridgeContext) {
                const event = request.getData();
                
                // Auto-accept invites
                if (event.type === "m.room.member" && event.state_key === bridge.getBot().getUserId() && event.content.membership === "invite") {
                    console.log(`[Bot] Received invite to ${event.room_id}. Joining...`);
                    await bridge.getIntent().join(event.room_id);
                    return;
                }

                if (event.type !== "m.room.message" || !event.content || event.content.body === undefined) return;
                
                const body = event.content.body as string; 
                const sender = event.sender;
                const roomId = event.room_id;
                const eventId = event.event_id;

                // --- EMPTY MESSAGE REDACTION ---
                // Redact messages that are empty or just whitespace (likely blackholed by Python)
                if (body.trim() === "") {
                    console.log(`[Janitor] Redacting empty message ${eventId} in ${roomId}`);
                    try {
                        await bridge.getBot().getClient().redactEvent(roomId, eventId, "EmptyBody");
                    } catch (e) {
                        console.error("[Janitor] Failed to redact empty message:", e);
                    }
                    return;
                }
                
                // --- JANITOR LOGIC (Restored) ---

                // 1. Find System
                const system = await prisma.system.findUnique({
                    where: { ownerId: sender },
                    include: { members: true }
                });

                if (!system) return;

                // 2. Check Tags
                for (const member of system.members) {
                    const tags = member.proxyTags as any[];
                    for (const tag of tags) {
                        if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                            // MATCH!
                            const cleanContent = body.slice(
                                tag.prefix.length, 
                                body.length - (tag.suffix?.length || 0)
                            ).trim();

                            if (!cleanContent) return;

                            console.log(`[Janitor] Proxying for ${member.name} in ${roomId}`);

                            // Check Permissions
                            try {
                                const botClient = bridge.getBot().getClient();
                                const botId = bridge.getBot().getUserId();
                                
                                // Fetch power levels
                                const powerLevels = await botClient.getRoomStateEvent(roomId, "m.room.power_levels", "");
                                const userLevel = powerLevels.users?.[botId] ?? powerLevels.users_default ?? 0;
                                const redactLevel = powerLevels.events?.["m.room.redaction"] ?? 50;

                                if (userLevel < redactLevel) {
                                    console.warn(`[Janitor] Missing permissions in ${roomId}. Level: ${userLevel}, Needed: ${redactLevel}`);
                                    await bridge.getIntent().sendText(roomId, "⚠️ I need Moderator permissions to redact messages. Please promote me!");
                                    return;
                                }

                                // 3. REDACT ORIGINAL (Fastest Action)
                                await botClient.redactEvent(roomId, eventId, "PluralProxy");
                            } catch (e) {
                                console.error("[Janitor] Failed to check permissions or redact:", e);
                            }

                            // 4. SEND GHOST MESSAGE
                            try {
                                const ghostLocalpart = `_plural_${member.id}`; 
                                const ghostUserId = `@${ghostLocalpart}:${DOMAIN}`;
                                const intent = bridge.getIntent(ghostUserId);
                                
                                await intent.setDisplayName(member.displayName || member.name);
                                if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);

                                await intent.sendText(roomId, cleanContent);
                            } catch (e) {
                                console.error("[Janitor] Failed to send ghost:", e);
                            }
                            
                            return; // Stop processing
                        }
                    }
                }
            }
        }
    });

    console.log("Starting Matrix Bridge...");
    await bridge.run(8008); 
};

export const getBridge = () => bridge;
