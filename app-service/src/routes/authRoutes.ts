import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticateToken } from '../auth';

const router = Router();

router.post('/login', authController.login);
router.get('/me', authenticateToken, authController.me);

export default router;
