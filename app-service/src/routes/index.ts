import { Router } from 'express';
import authRoutes from './authRoutes';
import memberRoutes from './memberRoutes';
import systemRoutes from './systemRoutes';
import importRoutes from './importRoutes';
import mediaRoutes from './mediaRoutes';
import gatekeeperRoutes from './gatekeeperRoutes';
import * as importController from '../controllers/importController';
import { authenticateToken } from '../auth';

const router = Router();

router.use('/auth', authRoutes);
router.use('/members', memberRoutes);
router.use('/system', systemRoutes);
router.use('/import', importRoutes);
router.use('/media', mediaRoutes);

// Compatibility for old frontend paths
router.get('/export/pluralkit', authenticateToken, importController.exportPluralKit);
router.get('/media/export', authenticateToken, importController.exportMedia);

router.use('/', gatekeeperRoutes);

export default router;
