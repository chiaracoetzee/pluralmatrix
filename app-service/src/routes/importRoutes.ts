import express, { Router } from 'express';
import * as importController from '../controllers/importController';
import { authenticateToken } from '../auth';

const router = Router();

router.use(authenticateToken);

// PluralKit JSON
router.post('/pluralkit', importController.importPluralKit);
router.get('/pluralkit', importController.exportPluralKit); // Compatibility for new structure
// Note: Frontend uses /api/export/pluralkit, which we will handle in routes/index.ts

// Media ZIP
router.get('/media', importController.exportMedia);
router.post('/media', express.raw({ type: 'application/zip', limit: '50mb' }), importController.importMedia);

export default router;
