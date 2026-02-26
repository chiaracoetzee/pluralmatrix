import { Router } from 'express';
import * as systemController from '../controllers/systemController';
import { authenticateToken } from '../auth';

const router = Router();

router.use(authenticateToken);

router.get('/', systemController.getSystem);
router.get('/events', systemController.streamSystemEvents);
router.get('/links', systemController.getLinks);
router.post('/links', systemController.createLink);
router.delete('/links/:mxid', systemController.deleteLink);
router.patch('/', systemController.updateSystem);

export default router;
