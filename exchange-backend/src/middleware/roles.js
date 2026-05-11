import { db } from '../db.js';

function normalizeRoles(roles) {
  if (Array.isArray(roles)) {
    return roles
      .map((role) => String(role || '').trim().toLowerCase())
      .filter(Boolean);
  }

  return String(roles || '')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

export function requireRole(role) {
  const requiredRole = String(role || '').trim().toLowerCase();

  return async (req, res, next) => {
    const tokenRoles = normalizeRoles(req.user?.roles);
    if (tokenRoles.includes(requiredRole)) {
      return next();
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({ status: false, code: 403, message: 'Forbidden' });
    }

    const user = await db('users').select('roles').where({ id: userId }).first();
    const dbRoles = normalizeRoles(user?.roles);
    if (!dbRoles.includes(requiredRole)) {
      return res.status(403).json({ status: false, code: 403, message: 'Forbidden' });
    }

    req.user = {
      ...req.user,
      roles: dbRoles,
    };
    return next();
  };
}

export function requireKycVerified(req, res, next) {
  if (!req.user?.kycVerified) {
    return res.status(403).json({ status: false, code: 403, message: 'KYC required' });
  }
  return next();
}
