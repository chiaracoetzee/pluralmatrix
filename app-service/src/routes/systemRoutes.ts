import { Router } from 'express';
import * as systemController from '../controllers/systemController';
import { authenticateToken } from '../auth';

const router = Router();

router.use(authenticateToken);

router.get('/', systemController.getSystem);
router.patch('/', systemController.updateSystem);

export default router;
