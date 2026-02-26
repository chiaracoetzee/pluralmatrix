import { Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { MemberSchema } from '../schemas/member';
import { proxyCache } from '../services/cache';
import { syncGhostProfile, decommissionGhost } from '../import';

export const listMembers = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: { include: { members: true } } }
        });
        res.json(link?.system?.members || []);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch members' });
    }
};

export const createMember = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const { name, displayName, avatarUrl, proxyTags, slug: providedSlug, description, pronouns, color } = MemberSchema.parse(req.body);

        const link = await prisma.accountLink.findUnique({ 
            where: { matrixId: mxid },
            include: { system: true }
        });
        if (!link) return res.status(404).json({ error: 'System not found' });
        const system = link.system;

        const baseSlug = providedSlug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const slug = providedSlug ? baseSlug : `${baseSlug}-${Date.now()}`;

        const member = await prisma.member.create({
            data: {
                systemId: system.id,
                slug: slug, 
                name,
                displayName,
                avatarUrl,
                proxyTags: proxyTags || [],
                description,
                pronouns,
                color
            }
        });

        // Sync profile to Matrix
        await syncGhostProfile(member, system);

        proxyCache.invalidate(mxid);
        res.json(member);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to create member' });
    }
};

export const updateMember = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;
        const updateData = MemberSchema.partial().parse(req.body);

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        const member = await prisma.member.findFirst({
            where: { id, systemId: link.systemId }
        });
        if (!member) return res.status(404).json({ error: 'Member not found' });

        const updated = await prisma.member.update({
            where: { id },
            data: updateData,
            include: { system: true }
        }) as any;

        // Sync updated profile to Matrix
        await syncGhostProfile(updated, updated.system);

        proxyCache.invalidate(mxid);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update member' });
    }
};

export const deleteMember = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        const member = await prisma.member.findFirst({
            where: { id, systemId: link.systemId },
            include: { system: true }
        });
        if (!member) return res.status(404).json({ error: 'Member not found' });

        // Cleanup Matrix state (Async)
        decommissionGhost(member, member.system);

        await prisma.member.delete({ where: { id } });
        proxyCache.invalidate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete member' });
    }
};

export const deleteAllMembers = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        // Find all members to decommission their ghosts first
        const members = await prisma.member.findMany({
            where: { systemId: link.systemId },
            include: { system: true }
        });

        for (const member of members) {
            decommissionGhost(member, member.system);
        }

        await prisma.member.deleteMany({
            where: { systemId: link.systemId }
        });
        proxyCache.invalidate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete all members' });
    }
};
