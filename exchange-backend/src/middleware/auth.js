import jwt from 'jsonwebtoken';
import { cfg } from '../config.js';
import { db } from '../db.js';
import { setRequestContextValue } from '../logging/context.js';
import { authLogger } from '../logging/loggers.js';

export function extractToken(req) {
  const headerCandidates = [
    req.headers.authorization,
    req.headers['x-access-token'],
    req.headers['x-auth-token'],
    req.headers['x-token'],
    req.headers.token,
  ];

  for (const value of headerCandidates) {
    if (!value) continue;
    if (typeof value === 'string' && value.startsWith('Bearer ')) {
      return value.slice(7).trim();
    }
    if (typeof value === 'string' && value.length > 0) {
      return value.trim();
    }
  }

  if (req.headers.cookie) {
    const parts = req.headers.cookie.split(';');
    for (const part of parts) {
      const [rawKey, rawValue] = part.split('=');
      if (!rawKey || !rawValue) continue;
      const key = rawKey.trim().toLowerCase();
      if (['token', 'access', 'access_token'].includes(key)) {
        return decodeURIComponent(rawValue.trim());
      }
    }
  }

  if (req.query?.token && typeof req.query.token === 'string') {
    return req.query.token.trim();
  }

  return null;
}

export async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    (req.log || authLogger).warn({ path: req.path, code: 'AUTH_MISSING' }, 'auth_missing');
    return res.status(401).json({ message: 'Unauthorized', code: 'AUTH_MISSING' });
  }

  try {
    req.user = jwt.verify(token, cfg.jwtSecret);
    const currentUser = await db('users').where({ id: req.user?.id }).first();
    const normalizedStatus = String(currentUser?.status || '').trim().toLowerCase();
    if (!currentUser || normalizedStatus === 'deleted') {
      (req.log || authLogger).warn(
        { path: req.path, userId: req.user?.id || null, code: 'ACCOUNT_DELETED' },
        'deleted_account_rejected'
      );
      return res.status(401).json({ message: 'Account deleted', code: 'ACCOUNT_DELETED' });
    }
    setRequestContextValue('userId', req.user?.id || null);
    if (req.log) {
      req.log = req.log.child({ userId: req.user?.id || null });
    }
    return next();
  } catch (err) {
    (req.log || authLogger).warn({ path: req.path, reason: err.message, code: 'AUTH_INVALID' }, 'token_rejected');
    return res.status(401).json({ message: 'Unauthorized', code: 'AUTH_INVALID' });
  }
}

export function verifyToken(token) {
  if (!token) throw new Error('AUTH_MISSING');
  return jwt.verify(token, cfg.jwtSecret);
}
