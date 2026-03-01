import { Response } from 'express';
import { AuthRequest } from '../auth';
import { PluralKitImportSchema } from '../schemas/import';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate } from '../services/events';
import { importFromPluralKit, exportToPluralKit, stringifyWithEscapedUnicode, exportAvatarsZip, importAvatarsZip } from '../import';

export const importPluralKit = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const jsonData = PluralKitImportSchema.parse(req.body);
        const result = await importFromPluralKit(mxid, jsonData);
        const { count, systemSlug } = result as any;
        proxyCache.invalidate(mxid); // Invalidate after import
        emitSystemUpdate(mxid);
        res.json({ success: true, count, systemSlug });
    } catch (e) {
        console.error('[ImportController] Import failed:', e);
        res.status(400).json({ error: 'Invalid PluralKit JSON format' });
    }
};

export const exportPluralKit = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const data = await exportToPluralKit(mxid);
        
        if (!data) return res.status(404).json({ error: 'System not found' });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=pluralkit_export.json');
        res.send(stringifyWithEscapedUnicode(data));
    } catch (e) {
        console.error('[ImportController] Export failed:', e);
        res.status(500).json({ error: 'Export failed' });
    }
};

export const exportMedia = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=avatars.zip');
        await exportAvatarsZip(mxid, res);
    } catch (e) {
        console.error('[ImportController] Media export failed:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Media export failed' });
    }
};

export const importMedia = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const count = await importAvatarsZip(mxid, req.body);
        proxyCache.invalidate(mxid); // Invalidate after avatar updates
        emitSystemUpdate(mxid);
        res.json({ success: true, count });
    } catch (e) {
        console.error('[ImportController] Media import failed:', e);
        res.status(500).json({ error: 'Media import failed' });
    }
};
