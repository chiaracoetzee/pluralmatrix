import { z } from 'zod';

export const GatekeeperCheckSchema = z.object({
    sender: z.string().startsWith('@'),
    room_id: z.string().startsWith('!'),
    content: z.object({
        body: z.string().optional(),
        msgtype: z.string().optional()
    }).optional()
});
