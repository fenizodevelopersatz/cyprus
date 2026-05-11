function padId(value, length = 6) {
  return String(Number(value) || 0).padStart(length, '0');
}

function yyyymmdd(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
}

const PREFIXES = {
  direct_sponsor_commission: 'DIR',
  joined_commission: 'JIN',
  level_bonus_10day: 'LVB',
  level_promotion_reward: 'LVR',
  signal_income: 'SIG',
  deposit: 'DPT',
  withdrawal: 'WDR',
};

export function buildTxnId(incomeType, eventAt, id) {
  const prefix = PREFIXES[incomeType] || 'INC';
  return `${prefix}-${yyyymmdd(eventAt)}-${padId(id)}`;
}

export function buildOrderId(eventAt, id) {
  return `ORD-${yyyymmdd(eventAt)}-${padId(id)}`;
}

export function buildSignalTxnId(eventAt, id) {
  return buildTxnId('signal_income', eventAt, id);
}

export function buildFundingTxnId(type, eventAt, id) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const key = normalizedType === 'withdrawal' ? 'withdrawal' : 'deposit';
  return buildTxnId(key, eventAt, id);
}
