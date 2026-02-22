import { Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { SystemSchema } from '../schemas/member';
import { proxyCache } from '../services/cache';

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
        const { name, systemTag, slug } = SystemSchema.parse(req.body);

        const updated = await prisma.system.update({
            where: { ownerId: mxid },
            data: { name, systemTag, slug }
        });
        proxyCache.invalidate(mxid);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update system' });
    }
};
