import { z } from 'zod';

export const ProxyTagSchema = z.object({
    prefix: z.string().min(1),
    suffix: z.string().optional().nullable()
});

export const MemberSchema = z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().max(100).optional().nullable(),
    avatarUrl: z.string().url().or(z.string().startsWith('mxc://')).optional().nullable(),
    proxyTags: z.array(ProxyTagSchema).optional(),
    slug: z.string().regex(/^[a-z0-9-]+$/).max(50).optional(),
    description: z.string().max(2000).optional().nullable(),
    pronouns: z.string().max(100).optional().nullable(),
    color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional().nullable()
});

export const SystemSchema = z.object({
    name: z.string().max(100).optional().nullable(),
    systemTag: z.string().max(50).optional().nullable(),
    slug: z.string().regex(/^[a-z0-9-]+$/).max(50).optional()
});
