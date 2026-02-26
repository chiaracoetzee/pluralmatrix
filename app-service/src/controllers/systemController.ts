import { Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { SystemSchema } from '../schemas/member';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate, systemEvents } from '../services/events';

import { ensureUniqueSlug } from '../utils/slug';

export const streamSystemEvents = async (req: AuthRequest, res: Response) => {
    const mxid = req.user!.mxid;
    console.log(`[SSE] Client connected: ${mxid}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial heartbeat
    res.write(': heartbeat\n\n');

    const onUpdate = (updatedMxid: string) => {
        if (updatedMxid.toLowerCase() === mxid.toLowerCase()) {
            res.write(`data: ${JSON.stringify({ type: 'SYSTEM_UPDATE' })}\n\n`);
        }
    };

    const heartbeatInterval = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    systemEvents.on('update', onUpdate);

    req.on('close', () => {
        console.log(`[SSE] Client disconnected: ${mxid}`);
        clearInterval(heartbeatInterval);
        systemEvents.off('update', onUpdate);
    });
};

export const getSystem = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: true }
        });

        if (link) {
            return res.json(link.system);
        }

        // Create new system and link
        const localpart = mxid.split(':')[0].substring(1);
        const slug = await ensureUniqueSlug(prisma, localpart);
        
        const system = await prisma.system.create({
            data: {
                slug,
                name: `${localpart}'s System`,
                accountLinks: {
                    create: { matrixId: mxid }
                }
            }
        });

        res.json(system);
    } catch (e) {
        console.error('[SystemController] Failed to fetch/create system:', e);
        res.status(500).json({ error: 'Failed to fetch system' });
    }
};

export const updateSystem = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const { name, systemTag, slug: requestedSlug, autoproxyId } = SystemSchema.parse(req.body);

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) {
            return res.status(404).json({ error: 'No system found for this account' });
        }

        const currentSystemId = link.systemId;
        let finalSlug = undefined;

        if (requestedSlug) {
            // Check if slug is taken by SOME OTHER system
            const existing = await prisma.system.findUnique({
                where: { slug: requestedSlug }
            });

            if (existing && existing.id !== currentSystemId) {
                return res.status(409).json({ error: `The slug '${requestedSlug}' is already taken.` });
            }
            finalSlug = requestedSlug;
        }

        const updated = await prisma.system.update({
            where: { id: currentSystemId },
            data: { 
                name, 
                systemTag, 
                slug: finalSlug, 
                autoproxyId 
            }
        });

        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json(updated);
    } catch (e) {
        console.error('[SystemController] Update failed:', e);
        res.status(500).json({ error: 'Failed to update system' });
    }
};

export const getLinks = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        const links = await prisma.accountLink.findMany({
            where: { systemId: link.systemId }
        });

        res.json(links);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch links' });
    }
};

export const createLink = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        let { targetMxid } = req.body;
        if (!targetMxid) return res.status(400).json({ error: 'Missing targetMxid' });

        targetMxid = targetMxid.toLowerCase();
        if (!targetMxid.startsWith('@')) targetMxid = `@${targetMxid}`;
        if (!targetMxid.includes(':')) {
            const domain = mxid.split(':')[1];
            targetMxid = `${targetMxid}:${domain}`;
        }

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        // Safety check: target existing system
        const targetLink = await prisma.accountLink.findUnique({
            where: { matrixId: targetMxid },
            include: { system: { include: { members: true, accountLinks: true } } }
        });

        if (targetLink) {
            if (targetLink.systemId === link.systemId) {
                return res.status(400).json({ error: 'Account is already linked' });
            }
            if (targetLink.system.members.length > 0) {
                return res.status(400).json({ error: 'Target account already has members in its system.' });
            }

            // Cleanup target's empty system if they were the only link
            if (targetLink.system.accountLinks.length === 1) {
                await prisma.system.delete({ where: { id: targetLink.systemId } });
            } else {
                await prisma.accountLink.delete({ where: { matrixId: targetMxid } });
            }
        }

        const newLink = await prisma.accountLink.create({
            data: { matrixId: targetMxid, systemId: link.systemId }
        });

        proxyCache.invalidate(targetMxid);
        emitSystemUpdate(targetMxid);
        res.json(newLink);
    } catch (e) {
        res.status(500).json({ error: 'Failed to create link' });
    }
};

export const deleteLink = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const targetMxid = (req.params.mxid as string).toLowerCase();

        if (targetMxid === mxid.toLowerCase()) {
            return res.status(400).json({ error: 'You cannot unlink your own account.' });
        }

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        const targetLink = await prisma.accountLink.findUnique({
            where: { matrixId: targetMxid }
        });

        if (!targetLink || targetLink.systemId !== link.systemId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await prisma.accountLink.delete({ where: { matrixId: targetMxid } });

        // Cleanup if no links remain
        const remaining = await prisma.accountLink.count({
            where: { systemId: link.systemId }
        });

        if (remaining === 0) {
            await prisma.system.delete({ where: { id: link.systemId } });
        }

        proxyCache.invalidate(targetMxid);
        emitSystemUpdate(targetMxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete link' });
    }
};
