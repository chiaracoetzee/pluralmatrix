import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, Intent } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { marked } from "marked";

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

// Configuration
const REGISTRATION_PATH = "/data/app-service-registration.yaml";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://localhost:8008";
const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";

// Placeholder for the bridge instance
let bridge: Bridge;

export const handleEvent = async (request: Request<WeakEvent>, context: BridgeContext | undefined, bridgeInstance: Bridge, prismaClient: PrismaClient) => {
    const event = request.getData();
    
    // Auto-accept invites
    if (event.type === "m.room.member" && event.state_key === bridgeInstance.getBot().getUserId() && event.content.membership === "invite") {
        console.log(`[Bot] Received invite to ${event.room_id}. Joining...`);
        await bridgeInstance.getIntent().join(event.room_id);
        return;
    }

    if (event.type !== "m.room.message" || !event.content || event.content.body === undefined) return;
    
    const body = event.content.body as string; 
    const sender = event.sender;
    const roomId = event.room_id;
    const eventId = event.event_id;

    // --- EMPTY MESSAGE REDACTION ---
    if (body.trim() === "" && !sender.startsWith("@_plural_") && sender !== bridgeInstance.getBot().getUserId()) {
        console.log(`[Janitor] Redacting empty message ${eventId} in ${roomId}`);
        try {
            await bridgeInstance.getBot().getClient().redactEvent(roomId, eventId, "EmptyBody");
        } catch (e) {
            console.error("[Janitor] Failed to redact empty message:", e);
        }
        return;
    }

    // --- CHAT COMMANDS ---
    if (body.startsWith("pk;")) {
        const parts = body.split(" ");
        const cmd = parts[0].substring(3).toLowerCase();

        // 1. pk;list - List all alters
        if (cmd === "list") {
            const system = await prismaClient.system.findUnique({
                where: { ownerId: sender },
                include: { members: true }
            });
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
            const member = await prismaClient.member.findFirst({
                where: { slug, system: { ownerId: sender } }
            });
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
    }
    
    // --- JANITOR LOGIC (Backup for non-blocking path) ---
    const system = await prismaClient.system.findUnique({
        where: { ownerId: sender },
        include: { members: true }
    });

    if (!system) return;

    for (const member of system.members) {
        const tags = member.proxyTags as any[];
        for (const tag of tags) {
            if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                if (!cleanContent) return;

                console.log(`[Janitor-Backup] Proxying for ${member.name} in ${roomId}`);

                try {
                    const botClient = bridgeInstance.getBot().getClient();
                    await botClient.redactEvent(roomId, eventId, "PluralProxy-Backup");
                } catch (e) {}

                try {
                    const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                    const intent = bridgeInstance.getIntent(ghostUserId);
                    
                    const finalDisplayName = system.systemTag 
                        ? `${member.displayName || member.name} ${system.systemTag}`
                        : (member.displayName || member.name);

                    try {
                        await intent.sendStateEvent(roomId, "m.room.member", ghostUserId, {
                            membership: "join",
                            displayname: finalDisplayName,
                            avatar_url: member.avatarUrl || undefined
                        });
                    } catch (joinError) {
                        await intent.join(roomId);
                        await intent.setDisplayName(finalDisplayName);
                        if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                    }

                    await intent.sendText(roomId, cleanContent);
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
            onUserQuery: function (queriedUser) {
                return {}; // Auto-create users
            },
            onEvent: async function (request: Request<WeakEvent>, context?: BridgeContext) {
                await handleEvent(request, context, bridge, prisma);
            }
        }
    });

    console.log("Starting Matrix Bridge...");
    await bridge.run(8008); 
};

export const getBridge = () => bridge;
