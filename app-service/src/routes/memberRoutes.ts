import { Router } from 'express';
import * as memberController from '../controllers/memberController';
import { authenticateToken } from '../auth';

const router = Router();

router.use(authenticateToken);

router.get('/', memberController.listMembers);
router.post('/', memberController.createMember);
router.patch('/:id', memberController.updateMember);
router.delete('/:id', memberController.deleteMember);
router.delete('/', memberController.deleteAllMembers);

export default router;
