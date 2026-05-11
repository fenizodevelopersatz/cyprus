import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok } from '../../utils/responses.js';
import { db } from '../../db.js';

const router = express.Router();
const adminGuard = [requireAuth, requireRole('admin')];

router.get('/session', adminGuard, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }

  const user = await db('users').where({ id: req.user.id }).first();
  if (!user) {
    return res.status(404).json({ error: 'ADMIN_USER_NOT_FOUND' });
  }

  ok(res, {
    id: user.id,
    email: user.email,
    roles: (user.roles || 'user').split(','),
    kycVerified: !!user.kyc_verified,
  });
});

export default router;
