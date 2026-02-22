import { Request, Response } from 'express';
import { MediaUploadSchema } from '../schemas/media';

const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://plural-synapse:8008";
const AS_TOKEN = process.env.AS_TOKEN || "secret_token";

export const uploadMedia = async (req: Request, res: Response) => {
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
        console.error('[MediaController] Upload failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const downloadMedia = async (req: Request, res: Response) => {
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
        console.error('[MediaController] Download proxy failed:', e);
        res.sendStatus(500);
    }
};
