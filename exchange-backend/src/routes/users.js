/**
 * @openapi
 * tags:
 *   - name: Users
 *     description: Authenticated user profile
 */

/**
 * @openapi
 * /users/me:
 *   get:
 *     summary: Current authenticated user
 *     security:
 *       - bearerAuth: []
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: User profile overview
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import { getCurrentUser } from '../services/dashboardService.js';

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  try {
    ok(res, await getCurrentUser(req.user?.id));
  } catch (err) {
    fail(res, err.message || 'Failed to load current user', err.status || 400);
  }
});

export default router;

