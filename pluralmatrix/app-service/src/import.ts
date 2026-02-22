import { prisma } from './bot';
import { getBridge } from './bot';

/**
 * Strips decorative emojis and converts name to a slug.
 * Fallback to defaultId if result is empty.
 */
export const generateSlug = (name: string, defaultId: string): string => {
    // 1. Remove all non-ASCII characters (emojis, etc)
    // and some common symbols while keeping basic name characters
    const clean = name
        .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-') // Spaces to hyphens
        .replace(/[^a-z0-9-]/g, '') // Remove non-alphanumeric except hyphens
        .replace(/-+/g, '-') // Collapse multiple hyphens
        .replace(/^-+|-+$/g, ''); // Trim hyphens

    return clean || defaultId.toLowerCase();
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
 * Main importer logic for PluralKit JSON.
 */
export const importFromPluralKit = async (mxid: string, jsonData: any) => {
    console.log(`[Importer] Starting import for ${mxid}`);

    // 1. Upsert System
    const system = await prisma.system.upsert({
        where: { ownerId: mxid },
        update: {
            name: jsonData.name,
            systemTag: jsonData.tag
        },
        create: {
            ownerId: mxid,
            name: jsonData.name,
            systemTag: jsonData.tag
        }
    });

    let importedCount = 0;

    // 2. Iterate Members
    for (const pkMember of jsonData.members || []) {
        try {
            const slug = generateSlug(pkMember.name, pkMember.id);
            
            // Map Proxy Tags (Prefixes only)
            const proxyTags = (pkMember.proxy_tags || [])
                .filter((t: any) => t.prefix)
                .map((t: any) => ({ prefix: t.prefix, suffix: "" }));

            // Migrate Avatar
            const avatarUrl = await migrateAvatar(pkMember.avatar_url);

            // Upsert Member
            await prisma.member.upsert({
                where: { slug: slug },
                update: {
                    name: pkMember.name,
                    displayName: pkMember.name,
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
                    displayName: pkMember.name,
                    avatarUrl: avatarUrl || undefined,
                    pronouns: pkMember.pronouns,
                    description: pkMember.description,
                    color: pkMember.color,
                    proxyTags: proxyTags
                }
            });

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
