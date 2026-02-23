import { Router } from 'express';
import * as gatekeeperController from '../controllers/gatekeeperController';

const router = Router();

router.post('/check', gatekeeperController.checkMessage);

export default router;
