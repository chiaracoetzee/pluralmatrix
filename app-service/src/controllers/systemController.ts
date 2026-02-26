import { Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { SystemSchema } from '../schemas/member';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate, systemEvents } from '../services/events';

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
        console.log(`[SSE] Internal update received for ${updatedMxid}. Comparing with client ${mxid}`);
        if (updatedMxid.toLowerCase() === mxid.toLowerCase()) {
            console.log(`[SSE] MATCH! Sending update to ${mxid}`);
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
        let system = await prisma.system.findUnique({
            where: { ownerId: mxid }
        });

        if (!system) {
            const localpart = mxid.split(':')[0].substring(1);
            system = await prisma.system.create({
                data: {
                    ownerId: mxid,
                    slug: localpart,
                    name: `${localpart}'s System`
                }
            });
        }

        res.json(system);
    } catch (e) {
        console.error('[SystemController] Failed to fetch/create system:', e);
        res.status(500).json({ error: 'Failed to fetch system' });
    }
};

export const updateSystem = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const { name, systemTag, slug, autoproxyId } = SystemSchema.parse(req.body);

        const updated = await prisma.system.update({
            where: { ownerId: mxid },
            data: { name, systemTag, slug, autoproxyId }
        });
        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update system' });
    }
};
