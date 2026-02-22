import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { startMatrixBot, getBridge, prisma } from './bot';
import { loginToMatrix, generateToken, authenticateToken, AuthRequest } from './auth';
import { importFromPluralKit } from './import';

const app = express();
const PORT = process.env.APP_PORT || 9000;
const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";
const AS_TOKEN = process.env.AS_TOKEN || "secret_token";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://plural-synapse:8008";

app.use(cors());
app.use(bodyParser.json());

/**
 * Authentication Endpoint
 */
app.post('/api/auth/login', async (req, res) => {
    const { mxid, password } = req.body;

    if (!mxid || !password) {
        return res.status(400).json({ error: 'Missing mxid or password' });
    }

    const success = await loginToMatrix(mxid, password);

    if (success) {
        await prisma.system.upsert({
            where: { ownerId: mxid },
            update: {},
            create: { ownerId: mxid, name: `${mxid.split(':')[0].substring(1)}'s System` }
        });

        const token = generateToken(mxid);
        return res.json({ token, mxid });
    } else {
        return res.status(401).json({ error: 'Invalid Matrix credentials' });
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
        const count = await importFromPluralKit(mxid, req.body);
        res.json({ success: true, count });
    } catch (e) {
        console.error('[API] Import failed:', e);
        res.status(500).json({ error: 'Import failed' });
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
        const { name, displayName, avatarUrl, proxyTags } = req.body;

        const system = await prisma.system.findUnique({ where: { ownerId: mxid } });
        if (!system) return res.status(404).json({ error: 'System not found' });

        const baseSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        const member = await prisma.member.create({
            data: {
                systemId: system.id,
                slug: `${baseSlug}-${Date.now()}`, 
                name,
                displayName,
                avatarUrl,
                proxyTags: proxyTags || []
            }
        });
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
        const updateData = req.body;

        const member = await prisma.member.findFirst({
            where: { id, system: { ownerId: mxid } }
        });
        if (!member) return res.status(403).json({ error: 'Unauthorized or not found' });

        const updated = await prisma.member.update({
            where: { id },
            data: updateData
        });
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
            where: { id, system: { ownerId: mxid } }
        });
        if (!member) return res.status(403).json({ error: 'Unauthorized or not found' });

        await prisma.member.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete member' });
    }
});

/**
 * Media Proxy Endpoint
 */
app.post('/api/media/upload', authenticateToken, express.raw({ type: 'image/*', limit: '10mb' }), async (req: any, res) => {
    try {
        const filename = (req.query.filename as string) || 'upload.png';
        const contentType = req.headers['content-type'] || 'image/png';

        const response = await fetch(`${HOMESERVER_URL}/_matrix/media/v3/upload?filename=${filename}`, {
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

/**
 * Existing Check Endpoint
 */
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

        if (!system) return res.json({ action: "ALLOW" });

        for (const member of system.members) {
            const tags = member.proxyTags as any[];
            for (const tag of tags) {
                if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                    const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                    if (!cleanContent) return res.json({ action: "ALLOW" });

                    console.log(`[API] MATCH FOUND! Member: ${member.name}. Clean content: "${cleanContent}"`);

                    (async () => {
                        try {
                            const bridge = getBridge();
                            if (bridge) {
                                const ghostUserId = `@_plural_${member.id}:${DOMAIN}`;
                                const intent = bridge.getIntent(ghostUserId);
                                
                                try { await intent.ensureRegistered(); } catch(e) {}
                                await intent.join(room_id);

                                // Update Profile with System Tag Suffix
                                const finalDisplayName = system.systemTag 
                                    ? `${member.displayName || member.name} ${system.systemTag}`
                                    : (member.displayName || member.name);

                                await intent.setDisplayName(finalDisplayName);
                                if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                                
                                await new Promise(r => setTimeout(r, 200));
                                await intent.sendText(room_id, cleanContent);
                            }
                        } catch (e) { 
                            console.error("[API] Async Ghost Error:", e); 
                        }
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

if (require.main === module) {
    startMatrixBot().then(() => {
        app.listen(PORT, () => {
            console.log(`App Service (Brain) listening on port ${PORT}`);
        });
    }).catch(err => {
        console.error("Failed to start Matrix Bot:", err);
        process.exit(1);
    });
}

export { app };
