import { PrismaClient } from "@prisma/client";

/**
 * Generates a unique slug for a system.
 * If the baseSlug is taken, it appends -2, -3, etc. until a free one is found.
 */
export async function ensureUniqueSlug(prisma: PrismaClient, baseSlug: string, currentSystemId?: string): Promise<string> {
    let slug = baseSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) slug = "system";

    let candidate = slug;
    let counter = 1;

    while (true) {
        const existing = await prisma.system.findUnique({
            where: { slug: candidate }
        });

        // If no system has this slug, it's free.
        // If the system having this slug is the CURRENT system, it's also effectively free (no change needed).
        if (!existing || (currentSystemId && existing.id === currentSystemId)) {
            return candidate;
        }

        counter++;
        candidate = `${slug}-${counter}`;
    }
}
