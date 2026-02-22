import { prisma } from './bot';
import { getBridge } from './bot';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

/**
 * Maps decorative, Greek, or Faux Cyrillic characters to their closest Latin equivalents.
 */
export const transliterate = (text: string): string => {
    const charMap: Record<string, string> = {
        // Faux Cyrillic / Aesthetic
        'Д': 'a', 'д': 'a',
        'В': 'b', 'в': 'b',
        'Ё': 'e', 'ё': 'e',
        'И': 'n', 'и': 'n',
        'Я': 'r', 'я': 'r',
        'Х': 'x', 'х': 'x',
        'У': 'y', 'у': 'y',
        '𐒰': 'a',
        // Faux Greek / Aesthetic
        'Σ': 'e', 'σ': 'e',
        'Λ': 'a', 'λ': 'a',
        'Π': 'n', 'π': 'n',
        'Φ': 'ph', 'φ': 'ph',
        'Ω': 'o', 'ω': 'o',
        'Δ': 'd', 'δ': 'd',
        'Θ': 'th', 'θ': 'th',
        'Ξ': 'x', 'ξ': 'x',
        'Ψ': 'ps', 'ψ': 'ps'
    };
    return [...text].map(c => charMap[c] || c).join('');
};

/**
 * Strips decorative emojis and converts name to a slug.
 * Fallback to defaultId if result is empty.
 */
export const generateSlug = (name: string, defaultId: string): string => {
    const transliterated = transliterate(name);

    const clean = transliterated
        .replace(/[^\x00-\x7F]/g, '') 
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-') 
        .replace(/[^a-z0-9-]/g, '') 
        .replace(/-+/g, '-') 
        .replace(/^-+|-+$/g, ''); 

    return clean || defaultId.toLowerCase();
};

/**
 * Extracts alphabetic-only lowercase prefix for slug resolution.
 */
export const getCleanPrefix = (pkMember: any): string => {
    const firstPrefix = pkMember.proxy_tags?.find((t: any) => t.prefix)?.prefix || "";
    return firstPrefix.replace(/[^a-zA-Z]/g, '').toLowerCase();
};

/**
 * Tries to extract a name from a description using common self-introduction patterns.
 */
export const extractNameFromDescription = (description: string | null): string | null => {
    if (!description) return null;
    
    const patterns = [
        /(?:My\s+name\s+is|my\s+name\s+is|I'm|i'm|I\s+am|i\s+am)\s+([A-Z][^.!?\n,]+)/
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match && match[1]) {
            const name = match[1].trim();
            if (name.length > 0 && name.length < 30 && name.split(/\s+/).length <= 4) return name;
        }
    }
    return null;
};

/**
 * Downloads an image from a URL and uploads it to the Matrix media repository.
 */
export const migrateAvatar = async (url: string): Promise<string | null> => {
    if (!url) return null;
    
    // If it's already an mxc:// URL, don't try to migrate it
    if (url.startsWith('mxc://')) return url;

    try {
        const bridge = getBridge();
        if (!bridge) return null;

        const response = await fetch(url);
        if (!response.ok) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'image/png';

        const mxcUrl = await bridge.getBot().getClient().uploadContent(buffer, contentType, 'avatar.png');

        return mxcUrl;
    } catch (e) {
        console.error(`[Importer] Failed to migrate avatar from ${url}:`, e);
        return null;
    }
};

/**
 * Sets the global profile for a ghost user.
 */
export const syncGhostProfile = async (member: any, system: any) => {
    try {
        const bridge = getBridge();
        if (!bridge) return;

        const domain = process.env.SYNAPSE_DOMAIN || 'localhost';
        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${domain}`;
        const intent = bridge.getIntent(ghostUserId);

        const finalDisplayName = system.systemTag 
            ? `${member.displayName || member.name} ${system.systemTag}`
            : (member.displayName || member.name);

        console.log(`[Ghost] Syncing global profile for ${ghostUserId} (${finalDisplayName})`);
        
        await intent.ensureRegistered();
        await intent.setDisplayName(finalDisplayName);
        if (member.avatarUrl) {
            await intent.setAvatarUrl(member.avatarUrl);
        }
    } catch (e: any) {
        console.error(`[Ghost] Failed to sync profile for ${member.slug}:`, e.message || e);
    }
};

/**
 * Cleanup a ghost user when a member is deleted.
 */
export const decommissionGhost = async (member: any, system: any) => {
    try {
        const bridge = getBridge();
        if (!bridge) return;

        const domain = process.env.SYNAPSE_DOMAIN || 'localhost';
        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${domain}`;
        const intent = bridge.getIntent(ghostUserId);

        console.log(`[Ghost] Decommissioning ${ghostUserId}...`);

        // 1. Get joined rooms
        const rooms = await intent.matrixClient.getJoinedRooms();
        
        // 2. Leave all rooms
        for (const roomId of rooms) {
            try {
                await intent.leave(roomId);
            } catch (e) {}
        }

        console.log(`[Ghost] ${ghostUserId} has left all rooms.`);
    } catch (e: any) {
        console.error(`[Ghost] Failed to decommission ${member.slug}:`, e.message || e);
    }
};

/**
 * Main importer logic for PluralKit JSON.
 */
export const importFromPluralKit = async (mxid: string, jsonData: any) => {
    console.log(`[Importer] Starting import for ${mxid}`);

    const isPluralMatrix = jsonData.config?.pluralmatrix_version !== undefined;
    const localpart = mxid.split(':')[0].substring(1);
    
    // If it's a PluralMatrix export, reuse the exact system slug provided
    const systemSlug = (isPluralMatrix && jsonData.id) 
        ? jsonData.id 
        : generateSlug(jsonData.name || localpart, localpart);

    const system = await prisma.system.upsert({
        where: { ownerId: mxid },
        update: {
            name: jsonData.name,
            systemTag: jsonData.tag,
            slug: systemSlug
        },
        create: {
            ownerId: mxid,
            slug: systemSlug,
            name: jsonData.name,
            systemTag: jsonData.tag
        }
    });

    const rawMembers = jsonData.members || [];
    const slugGroups: Record<string, any[]> = {};

    for (const member of rawMembers) {
        let baseSlug = (isPluralMatrix && member.id) 
            ? member.id 
            : generateSlug(member.name, ""); 
        
        if (!baseSlug) {
            const extractedName = extractNameFromDescription(member.description);
            if (extractedName) {
                baseSlug = generateSlug(extractedName, "");
            }
        }
        
        if (!baseSlug) {
            baseSlug = member.id.toLowerCase();
        }

        if (!slugGroups[baseSlug]) slugGroups[baseSlug] = [];
        slugGroups[baseSlug].push(member);
    }

    const processedMembers = [];
    for (const [baseSlug, members] of Object.entries(slugGroups)) {
        if (members.length === 1) {
            processedMembers.push({ ...members[0], finalSlug: baseSlug });
        } else {
            members.sort((a, b) => {
                const preA = getCleanPrefix(a);
                const preB = getCleanPrefix(b);
                return preA.length - preB.length || a.id.localeCompare(b.id);
            });

            members.forEach((m, idx) => {
                if (idx === 0) {
                    processedMembers.push({ ...m, finalSlug: baseSlug });
                } else {
                    const cleanPre = getCleanPrefix(m);
                    const suffix = cleanPre || m.id.toLowerCase();
                    processedMembers.push({ ...m, finalSlug: `${baseSlug}-${suffix}` });
                }
            });
        }
    }

    let importedCount = 0;

    for (const pkMember of processedMembers) {
        try {
            const slug = pkMember.finalSlug;
            const proxyTags = (pkMember.proxy_tags || [])
                .filter((t: any) => t.prefix)
                .map((t: any) => ({ prefix: t.prefix, suffix: "" }));

            const avatarUrl = await migrateAvatar(pkMember.avatar_url);

            const member = await prisma.member.upsert({
                where: { 
                    systemId_slug: {
                        systemId: system.id,
                        slug: slug
                    }
                },
                update: {
                    name: pkMember.name,
                    displayName: pkMember.display_name,
                    avatarUrl: avatarUrl || undefined,
                    pronouns: pkMember.pronouns,
                    description: pkMember.description,
                    color: pkMember.color,
                    proxyTags: proxyTags
                },
                create: {
                    systemId: system.id,
                    slug: slug,
                    name: pkMember.name,
                    displayName: pkMember.display_name,
                    avatarUrl: avatarUrl || undefined,
                    pronouns: pkMember.pronouns,
                    description: pkMember.description,
                    color: pkMember.color,
                    proxyTags: proxyTags
                }
            });

            // Sync Profile Globally immediately
            await syncGhostProfile(member, system);

            importedCount++;
            if (importedCount % 10 === 0) {
                console.log(`[Importer] Progress: ${importedCount} members...`);
            }
        } catch (memberError) {
            console.error(`[Importer] Failed to import member ${pkMember.name}:`, memberError);
        }
    }

    console.log(`[Importer] Successfully imported ${importedCount} members for ${mxid}`);
    return importedCount;
};

/**
 * Stringifies an object to JSON while escaping all non-ASCII characters 
 * using \uXXXX sequences for maximum compatibility.
 */
export const stringifyWithEscapedUnicode = (obj: any): string => {
    return JSON.stringify(obj, null, 4).replace(/[^\x00-\x7f]/g, (c) => {
        return "\\u" + c.charCodeAt(0).toString(16).padStart(4, '0');
    });
};

/**
 * Generates a PluralKit-compatible JSON export for a system.
 */
export const exportToPluralKit = async (mxid: string) => {
    const system = await prisma.system.findUnique({
        where: { ownerId: mxid },
        include: { members: true }
    });

    if (!system) return null;

    const pkExport = {
        version: 2,
        id: system.slug,
        uuid: system.id,
        name: system.name,
        description: null, // We don't store system description yet
        tag: system.systemTag,
        pronouns: null,
        avatar_url: null,
        banner: null,
        color: null,
        created: system.createdAt.toISOString(),
        webhook_url: null,
        privacy: {
            name_privacy: "public",
            avatar_privacy: "public",
            description_privacy: "public",
            banner_privacy: "public",
            pronoun_privacy: "public",
            member_list_privacy: "public",
            group_list_privacy: "public",
            front_privacy: "public",
            front_history_privacy: "public"
        },
        config: {
            pluralmatrix_version: 1,
            timezone: "UTC",
            pings_enabled: true,
            latch_timeout: null,
            member_default_private: false,
            group_default_private: false,
            show_private_info: true,
            member_limit: 1000,
            group_limit: 250,
            case_sensitive_proxy_tags: true,
            proxy_error_message_enabled: true,
            hid_display_split: false,
            hid_display_caps: false,
            hid_list_padding: "off",
            card_show_color_hex: false,
            proxy_switch: "off",
            name_format: null,
            description_templates: []
        },
        accounts: [],
        members: system.members.map(m => ({
            id: m.slug,
            uuid: m.id,
            name: m.name,
            display_name: m.displayName,
            color: m.color,
            birthday: null,
            pronouns: m.pronouns,
            avatar_url: m.avatarUrl,
            webhook_avatar_url: null,
            banner: null,
            description: m.description,
            created: m.createdAt.toISOString(),
            keep_proxy: false,
            tts: false,
            autoproxy_enabled: true,
            message_count: 0,
            last_message_timestamp: null,
            proxy_tags: m.proxyTags,
            privacy: {
                visibility: "public",
                name_privacy: "public",
                description_privacy: "public",
                banner_privacy: "public",
                birthday_privacy: "public",
                pronoun_privacy: "public",
                avatar_privacy: "public",
                metadata_privacy: "public",
                proxy_privacy: "public"
            }
        })),
        switches: []
    };

    return pkExport;
};

/**
 * Fetches all member avatars and bundles them into a ZIP file.
 */
export const exportAvatarsZip = async (mxid: string, stream: NodeJS.WritableStream) => {
    const system = await prisma.system.findUnique({
        where: { ownerId: mxid },
        include: { members: true }
    });

    if (!system) throw new Error("System not found");

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(stream);

    const bridge = getBridge();
    if (!bridge) throw new Error("Bridge not initialized");

    const homeserverUrl = process.env.SYNAPSE_URL || "http://plural-synapse:8008";
    const asToken = process.env.AS_TOKEN || "";

    for (const member of system.members) {
        if (!member.avatarUrl || !member.avatarUrl.startsWith('mxc://')) continue;

        try {
            const mxc = member.avatarUrl.replace('mxc://', '');
            const [server, mediaId] = mxc.split('/');
            
            const response = await fetch(`${homeserverUrl}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${asToken}` }
            });

            if (!response.ok) {
                console.warn(`[Export] Failed to download avatar for ${member.name} (${member.avatarUrl}): ${response.status}`);
                continue;
            }

            const contentType = response.headers.get('content-type') || 'image/png';
            const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
            const buffer = Buffer.from(await response.arrayBuffer());

            // Descriptive filename: slug_mediaId.ext
            archive.append(buffer, { name: `${member.slug}_${mediaId}.${ext}` });
        } catch (e) {
            console.error(`[Export] Error adding avatar for ${member.name} to ZIP:`, e);
        }
    }

    await archive.finalize();
};

/**
 * Imports a ZIP of avatars and updates member mappings.
 */
export const importAvatarsZip = async (mxid: string, zipBuffer: Buffer) => {
    const system = await prisma.system.findUnique({
        where: { ownerId: mxid },
        include: { members: true }
    });

    if (!system) throw new Error("System not found");

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const bridge = getBridge();
    if (!bridge) throw new Error("Bridge not initialized");

    let count = 0;

    for (const entry of entries) {
        if (entry.isDirectory) continue;

        const filename = entry.entryName;
        const namePart = filename.split('.')[0];
        // Extract mediaId (part after the first underscore, if any)
        const oldMediaId = namePart.includes('_') ? namePart.split('_').slice(1).join('_') : namePart;
        const ext = filename.split('.')[1] || 'png';
        const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

        // Find members who have this mediaId in their current mxc URL
        const affectedMembers = system.members.filter(m => 
            m.avatarUrl && m.avatarUrl.endsWith(`/${oldMediaId}`)
        );

        if (affectedMembers.length === 0) continue;

        try {
            const mxcUrl = await bridge.getBot().getClient().uploadContent(entry.getData(), contentType, filename);

            for (const member of affectedMembers) {
                const updated = await prisma.member.update({
                    where: { id: member.id },
                    data: { avatarUrl: mxcUrl }
                });
                await syncGhostProfile(updated, system);
            }
            count++;
        } catch (e) {
            console.error(`[Import] Failed to re-upload avatar ${filename}:`, e);
        }
    }

    return count;
};
