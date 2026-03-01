import { z } from 'zod';

export const GatekeeperCheckSchema = z.object({
    event_id: z.string().startsWith('$').optional(),
    sender: z.string().startsWith('@'),
    bot_id: z.string().startsWith('@').optional(),
    room_id: z.string().startsWith('!'),
    content: z.object({
        body: z.string().optional(),
        msgtype: z.string().optional()
    }).optional()
});
