import { prisma } from './bot';
import { getBridge } from './bot';

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
 * Main importer logic for PluralKit JSON.
 */
export const importFromPluralKit = async (mxid: string, jsonData: any) => {
    console.log(`[Importer] Starting import for ${mxid}`);

    const localpart = mxid.split(':')[0].substring(1);
    const systemSlug = generateSlug(jsonData.name || localpart, localpart);

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
        let baseSlug = generateSlug(member.name, ""); 
        
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
