import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { startMatrixBot, getBridge, prisma } from './bot';
import { loginToMatrix, generateToken, authenticateToken, AuthRequest } from './auth';
import { importFromPluralKit, syncGhostProfile } from './import';

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
    let { mxid, password } = req.body;

    if (!mxid || !password) {
        return res.status(400).json({ error: 'Missing mxid or password' });
    }

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
        const { name, systemTag, slug } = req.body;

        const updated = await prisma.system.update({
            where: { ownerId: mxid },
            data: { name, systemTag, slug }
        });
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
        const { name, displayName, avatarUrl, proxyTags, slug: providedSlug } = req.body;

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
                proxyTags: proxyTags || []
            }
        });

        // Sync profile to Matrix
        await syncGhostProfile(member, system);

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
            data: updateData,
            include: { system: true }
        });

        // Sync updated profile to Matrix
        await syncGhostProfile(updated, updated.system);

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

// Bulk delete all members for user
app.delete('/api/members', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const mxid = req.user!.mxid;
        await prisma.member.deleteMany({
            where: { system: { ownerId: mxid } }
        });
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
    const { sender, content, room_id } = req.body;
    const body = content?.body || "";

    if (!body || !sender || !room_id) {
        return res.json({ action: "ALLOW" });
    }

    const cleanSender = sender.toLowerCase();

    try {
        const system = await prisma.system.findUnique({
            where: { ownerId: cleanSender },
            include: { members: true }
        });

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
                            
                            // Strategy: The "Typing Feint"
                            // Force client to resolve user profile via typing indicator before message arrives.
                            try {
                                await intent.sendTyping(room_id, true);
                                await new Promise(r => setTimeout(r, 200)); // Brief pause to let client process
                                await intent.sendTyping(room_id, false);
                            } catch (e) {
                                // Ignore typing errors
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
        console.error("[API] Gatekeeper Error:", e);
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
