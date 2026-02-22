import express from 'express';
import bodyParser from 'body-parser';
import { PrismaClient } from '@prisma/client';
import { startMatrixBot, getBridge } from './bot';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.APP_PORT || 9000;
const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";

app.use(bodyParser.json());

app.post('/check', async (req, res) => {
    const { sender, content, room_id } = req.body;
    const body = content?.body || "";

    if (!body || !sender || !room_id) {
        return res.json({ action: "ALLOW" });
    }

    try {
        const system = await prisma.system.findUnique({
            where: { ownerId: sender },
            include: { members: true }
        });

        if (!system) {
            console.log(`[API] No system found for ${sender}`);
            return res.json({ action: "ALLOW" });
        }

        console.log(`[API] Checking ${system.members.length} members for ${sender}. Message: "${body}"`);

        for (const member of system.members) {
            const tags = member.proxyTags as any[];
            for (const tag of tags) {
                const match = body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true);
                
                if (match) {
                    const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                    console.log(`[API] MATCH FOUND! Member: ${member.name}. Clean content: "${cleanContent}"`);

                    if (!cleanContent) {
                        console.log(`[API] Clean content is empty, skipping proxy.`);
                        continue;
                    }

                    // Trigger Ghost (Async)
                    (async () => {
                        try {
                            const bridge = getBridge();
                            if (bridge) {
                                const ghostUserId = `@_plural_${member.id}:${DOMAIN}`;
                                const intent = bridge.getIntent(ghostUserId);
                                await intent.setDisplayName(member.displayName || member.name);
                                if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                                await intent.sendText(room_id, cleanContent);
                                console.log(`[API] Ghost message sent for ${member.name}`);
                            }
                        } catch (e) { console.error("[API] Async Ghost Error:", e); }
                    })();

                    return res.json({ action: "BLOCK" });
                }
            }
        }
        
        return res.json({ action: "ALLOW" });
    } catch (e) {
        console.error("[API] Gatekeeper Error:", e);
        return res.json({ action: "ALLOW" });
    }
});

// Start Matrix Bot first, then API
startMatrixBot().then(() => {
    app.listen(PORT, () => {
        console.log(`App Service (Brain) listening on port ${PORT}`);
    });
}).catch(err => {
    console.error("Failed to start Matrix Bot:", err);
    process.exit(1);
});
