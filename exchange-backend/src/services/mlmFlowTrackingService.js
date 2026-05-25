import { db } from '../db.js';
import { cfg } from '../config.js';

function toMicroTimestamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace('Z', '000Z');
}

export async function recordMlmFlowStep(
  trx,
  {
    userId = null,
    depositId = null,
    flowType = 'deposit_to_freeze',
    stepKey,
    stepStatus = 'completed',
    txnGlobalSequence = null,
    meta = null,
    completedAt = new Date(),
  }
) {
  if (!cfg.mlm?.flowTrackingEnabled) return null;
  if (!stepKey) return null;

  const payload = {
    user_id: userId ? Number(userId) : null,
    deposit_id: depositId ? Number(depositId) : null,
    flow_type: flowType,
    step_key: stepKey,
    step_status: stepStatus,
    txn_global_sequence: txnGlobalSequence ? String(txnGlobalSequence) : null,
    completed_at: completedAt,
    meta: meta ? JSON.stringify({ ...meta, completed_at_iso: toMicroTimestamp(completedAt) }) : JSON.stringify({ completed_at_iso: toMicroTimestamp(completedAt) }),
    created_at: completedAt,
    updated_at: completedAt,
  };

  return trx('mlm_flow_tracking').insert(payload);
}
