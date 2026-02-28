import { Router } from 'express';
import * as systemController from '../controllers/systemController';
import { authenticateToken } from '../auth';

const router = Router();

router.get('/public/:slug', systemController.getPublicSystem);

router.use(authenticateToken);

router.get('/', systemController.getSystem);
router.get('/events', systemController.streamSystemEvents);
router.get('/links', systemController.getLinks);
router.post('/links', systemController.createLink);
router.post('/links/primary', systemController.setPrimaryAccount);
router.delete('/links/:mxid', systemController.deleteLink);
router.patch('/', systemController.updateSystem);

// DLQ Routes
router.get('/dead_letters', systemController.getDeadLetters);
router.delete('/dead_letters/:id', systemController.deleteDeadLetter);

export default router;
