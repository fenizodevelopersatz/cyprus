import { db } from '../db.js';

export async function audit(userId, action, details) {
  const now = new Date();
  await db('audit_logs').insert({
    user_id: userId || null,
    action,
    details: JSON.stringify(details || {}),
    created_at: now,
    updated_at: now,
  });
}
