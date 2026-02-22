import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { startMatrixBot, getBridge, prisma } from './bot';
import { loginToMatrix, generateToken, authenticateToken, AuthRequest } from './auth';
import { importFromPluralKit, syncGhostProfile, decommissionGhost, exportToPluralKit, stringifyWithEscapedUnicode, exportAvatarsZip, importAvatarsZip } from './import';
import { proxyCache } from './services/cache';
import { z } from 'zod';
import { MemberSchema, SystemSchema } from './schemas/member';
import { LoginSchema } from './schemas/auth';
import { PluralKitImportSchema } from './schemas/import';
import { MediaUploadSchema } from './schemas/media';
import { GatekeeperCheckSchema } from './schemas/gatekeeper';

const app = express();
const PORT = process.env.APP_PORT || 9000;
const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";
const AS_TOKEN = process.env.AS_TOKEN || "secret_token";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://plural-synapse:8008";

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the React app
const clientPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientPath));

/**
 * Authentication Endpoint
 */
app.post('/api/auth/login', async (req, res) => {
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
});

/**
 * Token Verification Endpoint
 */
app.get('/api/auth/me', authenticateToken, (req: AuthRequest, res) => {
    res.json({ user: req.user });
});

/**
 * Import API
 */
app.post('/api/import/pluralkit', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const jsonData = PluralKitImportSchema.parse(req.body);
        const count = await importFromPluralKit(mxid, jsonData);
        proxyCache.invalidate(mxid); // Invalidate after import
        res.json({ success: true, count });
    } catch (e) {
        console.error('[API] Import failed:', e);
        res.status(400).json({ error: 'Invalid PluralKit JSON format' });
    }
});

app.get('/api/export/pluralkit', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const data = await exportToPluralKit(mxid);
        
        if (!data) return res.status(404).json({ error: 'System not found' });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=pluralkit_export.json');
        res.send(stringifyWithEscapedUnicode(data));
    } catch (e) {
        console.error('[API] Export failed:', e);
        res.status(500).json({ error: 'Export failed' });
    }
});

app.get('/api/media/export', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=avatars.zip');
        await exportAvatarsZip(mxid, res);
    } catch (e) {
        console.error('[API] Media export failed:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Media export failed' });
    }
});

app.post('/api/media/import', authenticateToken, express.raw({ type: 'application/zip', limit: '50mb' }), async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const count = await importAvatarsZip(mxid, req.body);
        proxyCache.invalidate(mxid); // Invalidate after avatar updates
        res.json({ success: true, count });
    } catch (e) {
        console.error('[API] Media import failed:', e);
        res.status(500).json({ error: 'Media import failed' });
    }
});

/**
 * System Management API
 */

// Get current system
app.get('/api/system', authenticateToken, async (req: AuthRequest, res) => {
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
        console.error('[API] Failed to fetch/create system:', e);
        res.status(500).json({ error: 'Failed to fetch system' });
    }
});

// Update system
app.patch('/api/system', authenticateToken, async (req: AuthRequest, res) => {
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
});

/**
 * Member Management API
 */

// List all members
app.get('/api/members', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const system = await prisma.system.findUnique({
            where: { ownerId: mxid },
            include: { members: true }
        });
        res.json(system?.members || []);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// Create new member
app.post('/api/members', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const { name, displayName, avatarUrl, proxyTags, slug: providedSlug, description, pronouns, color } = MemberSchema.parse(req.body);

        const system = await prisma.system.findUnique({ where: { ownerId: mxid } });
        if (!system) return res.status(404).json({ error: 'System not found' });

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
});

// Update member
app.patch('/api/members/:id', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;
        const updateData = MemberSchema.partial().parse(req.body);

        const member = await prisma.member.findFirst({
            where: { id, system: { ownerId: mxid } }
        });
        if (!member) return res.status(403).json({ error: 'Unauthorized or not found' });

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
});

// Delete member
app.delete('/api/members/:id', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;

        const member = await prisma.member.findFirst({
            where: { id, system: { ownerId: mxid } },
            include: { system: true }
        });
        if (!member) return res.status(403).json({ error: 'Unauthorized or not found' });

        // Cleanup Matrix state (Async)
        decommissionGhost(member, member.system);

        await prisma.member.delete({ where: { id } });
        proxyCache.invalidate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete member' });
    }
});

// Bulk delete all members for user
app.delete('/api/members', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        
        // Find all members to decommission their ghosts first
        const members = await prisma.member.findMany({
            where: { system: { ownerId: mxid } },
            include: { system: true }
        });

        for (const member of members) {
            decommissionGhost(member, member.system);
        }

        await prisma.member.deleteMany({
            where: { system: { ownerId: mxid } }
        });
        proxyCache.invalidate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete all members' });
    }
});

/**
 * Media Proxy Endpoints
 */

// Upload Proxy
app.post('/api/media/upload', authenticateToken, express.raw({ type: 'image/*', limit: '10mb' }), async (req: any, res) => {
    try {
        const { filename } = MediaUploadSchema.parse(req.query);
        const contentType = req.headers['content-type'] || 'image/png';

        const response = await fetch(`${HOMESERVER_URL}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AS_TOKEN}`,
                'Content-Type': contentType
            },
            body: req.body
        });

        const data = await response.json() as any;
        if (response.ok) {
            res.json({ content_uri: data.content_uri });
        } else {
            res.status(response.status).json(data);
        }
    } catch (e) {
        console.error('[Media] Upload failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Download Proxy (to avoid CORS)
app.get('/api/media/download/:server/:mediaId', async (req, res) => {
    try {
        const { server, mediaId } = req.params;
        // Modern Synapse requires authenticated media download via /client/v1/
        const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
            headers: {
                'Authorization': `Bearer ${AS_TOKEN}`
            }
        });
        
        if (!response.ok) return res.sendStatus(response.status);
        
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (e) {
        console.error('[Media] Download proxy failed:', e);
        res.sendStatus(500);
    }
});

/**
 * Existing Check Endpoint
 */
app.post('/check', async (req, res) => {
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

                    console.log(`[API] PROXY MATCH! Member: ${member.name} (${member.slug}) for sender ${sender}`);

                    // Trigger Ghost (Async)
                    (async () => {
                        try {
                            const bridge = getBridge();
                            if (!bridge) {
                                console.error("[API] Bridge not initialized!");
                                return;
                            }

                            // Use slug for cleaner MXIDs if possible, or fallback to UUID
                            const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                            console.log(`[API] Sending ghost message as ${ghostUserId}`);
                            
                            const intent = bridge.getIntent(ghostUserId);
                            
                            try { 
                                await intent.ensureRegistered(); 
                            } catch(e: any) {
                                if (e.errcode !== 'M_USER_IN_USE') console.error("[API] Registration error:", e.message);
                            }
                            
                            const finalDisplayName = system.systemTag 
                                ? `${member.displayName || member.name} ${system.systemTag}`
                                : (member.displayName || member.name);

                            // Strategy: Explicit Join Payload (Keep this, it's good practice)
                            try {
                                await intent.sendStateEvent(room_id, "m.room.member", ghostUserId, {
                                    membership: "join",
                                    displayname: finalDisplayName,
                                    avatar_url: member.avatarUrl || undefined
                                });
                                                        } catch (joinError) {
                                                            await intent.join(room_id);
                                                            await intent.setDisplayName(finalDisplayName);
                                                            if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                                                        }
                            
                                                        await intent.sendText(room_id, cleanContent);
                                                        console.log(`[API] Ghost message sent!`);
                        } catch (e: any) { 
                            console.error("[API] Ghost Error:", e.message || e); 
                        }
                    })();

                    return res.json({ action: "BLOCK" });
                }
            }
        }
        return res.json({ action: "ALLOW" });
    } catch (e) {
        console.warn("[API] Gatekeeper Validation/Processing Error:", e);
        return res.json({ action: "ALLOW" });
    }
});

// All other requests will return the React app
app.use((req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

if (require.main === module) {
    startMatrixBot().then(async () => {
        app.listen(PORT, () => {
            console.log(`App Service (Brain) listening on port ${PORT}`);
        });
    }).catch(err => {
        console.error("Failed to start Matrix Bot:", err);
        process.exit(1);
    });
}

export { app };
