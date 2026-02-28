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

        // Bypass proxying if the message starts with a backslash or is a pk; command
        if (body.startsWith("\\") || body.toLowerCase().startsWith("pk;")) {
            return res.json({ action: "ALLOW" });
        }

        for (const member of system.members) {
            const tags = member.proxyTags as any[];
            for (const tag of tags) {
                if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                    const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                    if (!cleanContent) continue;

                    // Match found: Triggering ghost message dispatch
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
                        asToken: asToken,
                        senderId: sender
                    }).catch(e => {
                        console.error("[Gatekeeper] Failed to send ghost message:", e.message);
                    });

                    return res.json({ action: "BLOCK" });
                }
            }
        }

        // If no explicit tags match, check for autoproxy
        if (system.autoproxyId) {
            const autoMember = system.members.find(m => m.id === system.autoproxyId);
            if (autoMember) {
                const cleanContent = body.trim();
                if (cleanContent) {
                    // Match found: Triggering autoproxy message dispatch
                    sendGhostMessage({
                        roomId: room_id,
                        cleanContent,
                        system,
                        member: {
                            slug: autoMember.slug,
                            name: autoMember.name,
                            displayName: autoMember.displayName,
                            avatarUrl: autoMember.avatarUrl
                        },
                        asToken: asToken,
                        senderId: sender
                    }).catch(e => {
                        console.error("[Gatekeeper] Failed to send autoproxy ghost message:", e.message);
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
