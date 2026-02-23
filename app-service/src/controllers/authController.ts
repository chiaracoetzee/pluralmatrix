import { Request, Response } from 'express';
import { prisma } from '../bot';
import { loginToMatrix, generateToken, AuthRequest } from '../auth';
import { proxyCache } from '../services/cache';
import { LoginSchema } from '../schemas/auth';

const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";

export const login = async (req: Request, res: Response) => {
    try {
        let { mxid, password } = LoginSchema.parse(req.body);

        const success = await loginToMatrix(mxid, password);

        if (success) {
            // Consistently lowercase and format the MXID
            mxid = mxid.toLowerCase();
            if (!mxid.startsWith('@')) mxid = `@${mxid}`;
            if (!mxid.includes(':')) mxid = `${mxid}:${DOMAIN}`;

            const localpart = mxid.split(':')[0].substring(1);

            await prisma.system.upsert({
                where: { ownerId: mxid },
                update: {},
                create: { 
                    ownerId: mxid, 
                    slug: localpart,
                    name: `${localpart}'s System` 
                }
            });

            // Invalidate cache to ensure new system is picked up if needed
            proxyCache.invalidate(mxid);

            const token = generateToken(mxid);
            return res.json({ token, mxid });
        } else {
            return res.status(401).json({ error: 'Invalid Matrix credentials' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid input format' });
    }
};

export const me = (req: AuthRequest, res: Response) => {
    res.json({ user: req.user });
};
