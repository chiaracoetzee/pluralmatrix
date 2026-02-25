import { Request, Response } from 'express';
import { prisma, asToken } from '../bot';
import { proxyCache } from '../services/cache';
import { GatekeeperCheckSchema } from '../schemas/gatekeeper';
import { sendGhostMessage } from '../services/ghostService';

export const checkMessage = async (req: Request, res: Response) => {
    try {
        const { sender, content, room_id } = GatekeeperCheckSchema.parse(req.body);
        const body = content?.body || "";

        const cleanSender = sender.toLowerCase();
        const system = await proxyCache.getSystemRules(cleanSender, prisma);

        if (!system) {
            return res.json({ action: "ALLOW" });
        }

        for (const member of system.members) {
            const tags = member.proxyTags as any[];
            for (const tag of tags) {
                if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                    const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                    if (!cleanContent) continue;

                    console.log(`[Gatekeeper] PROXY MATCH! Member: ${member.name} (${member.slug}) for sender ${sender}`);

                    // Trigger Ghost using the global Appservice Token
                    sendGhostMessage({
                        roomId: room_id,
                        cleanContent,
                        system,
                        member: {
                            slug: member.slug,
                            name: member.name,
                            displayName: member.displayName,
                            avatarUrl: member.avatarUrl
                        },
                        asToken: asToken
                    }).catch(e => {
                        console.error("[Gatekeeper] Failed to send ghost message:", e.message);
                    });

                    return res.json({ action: "BLOCK" });
                }
            }
        }
        return res.json({ action: "ALLOW" });
    } catch (e) {
        console.warn("[Gatekeeper] Validation/Processing Error:", e);
        return res.json({ action: "ALLOW" });
    }
};
