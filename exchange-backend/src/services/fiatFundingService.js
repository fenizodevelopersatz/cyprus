import { parseUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { journal } from './ledgerService.js';
import { getSettings } from './settingsService.js';
import { cfg } from '../config.js';
import {
  sendStripeDepositSuccessEmail,
  sendStripeDepositFailureEmail,
} from './mailService.js';
import { getUserContact } from './userService.js';

const METHODS = ['stripe', 'bank', 'stripe_checkout'];
const STATUSES = ['requires_payment', 'pending_review', 'approved', 'rejected', 'canceled'];
const WALLET_NAMESPACE = {
  spot: 'spot:available',
  futures: 'futures:available',
};
const FIAT_CLEARING_NAMESPACE = 'fiat:clearing';
const CREDIT_ASSET = 'USDT';
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function normalizeMethod(method) {
  const value = String(method || '').toLowerCase();
  if (!METHODS.includes(value)) {
    throw createHttpError('UNSUPPORTED_METHOD', 400);
  }
  return value;
}

function normalizeWallet(wallet) {
  const value = String(wallet || 'spot').toLowerCase();
  if (!WALLET_NAMESPACE[value]) {
    throw createHttpError('WALLET_UNAVAILABLE', 400);
  }
  return value;
}

function resolveInsertId(result) {
  if (Array.isArray(result)) {
    return typeof result[0] === 'object' ? result[0].id ?? Object.values(result[0])[0] : result[0];
  }
  if (result && typeof result === 'object') {
    return result.id ?? Object.values(result)[0];
  }
  return result;
}

function createHttpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serializeDeposit(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    method: row.method,
    status: row.status,
    wallet: row.wallet,
    amount: Number(row.amount),
    currency: row.currency,
    reference: row.reference,
    proofUrl: row.proof_url,
    paymentIntentId: row.payment_intent_id || null,
    paymentIntentSecret: row.payment_intent_secret || null,
    reviewerId: row.reviewer_id || null,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meta: row.meta ? JSON.parse(row.meta) : null,
  };
}

function toMinorUnits(amount, currency = 'USD') {
  const decimals = currency.toUpperCase() === 'JPY' ? 0 : 2;
  const multiplier = 10 ** decimals;
  const cents = Math.round(Number(amount) * multiplier);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw createHttpError('INVALID_AMOUNT', 400);
  }
  return { cents, decimals };
}

async function resolveStripeSecret() {
  const settings = await getSettings();
  const secret =
    settings.stripeSecretKey || process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
  if (!secret) throw createHttpError('STRIPE_NOT_CONFIGURED', 422);
  return secret;
}

async function handleStripeResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }
  if (!response.ok) {
    let message = 'STRIPE_REQUEST_FAILED';
    if (payload?.error?.message) {
      message = `STRIPE: ${payload.error.message}`;
    }
    const err = createHttpError(message, response.status >= 400 && response.status < 500 ? 400 : 502);
    err.meta = payload;
    throw err;
  }
  return payload;
}

async function stripeRequest(path, { method = 'POST', params } = {}) {
  const secret = await resolveStripeSecret();
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  };
  if (method === 'POST') {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = params;
  }
  const response = await fetch(`${STRIPE_API_BASE}${path}`, options);
  return handleStripeResponse(response);
}

async function createStripeIntent({ amount, currency, metadata }) {
  const { cents } = toMinorUnits(amount, currency);
  const params = new URLSearchParams();
  params.append('amount', String(cents));
  params.append('currency', currency.toLowerCase());
  params.append('automatic_payment_methods[enabled]', 'true');
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.append(`metadata[${key}]`, String(value));
  });

  return stripeRequest('/payment_intents', { params });
}

export async function createFiatDeposit({
  userId,
  method,
  amount,
  currency = 'USD',
  wallet = 'spot',
  reference,
  proofUrl,
}) {
  if (!userId) throw createHttpError('USER_REQUIRED', 400);
  const normalizedMethod = normalizeMethod(method);
  const normalizedWallet = normalizeWallet(wallet);
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    throw createHttpError('INVALID_AMOUNT', 400);
  }

  const insertPayload = {
    user_id: userId,
    method: normalizedMethod,
    status: normalizedMethod === 'stripe' ? 'requires_payment' : 'pending_review',
    wallet: normalizedWallet,
    amount: amountNumber.toFixed(2),
    currency: String(currency || 'USD').toUpperCase(),
    reference: reference ? String(reference).trim() : null,
    proof_url: proofUrl ? String(proofUrl).trim() : null,
    meta: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  if (normalizedMethod === 'bank' && !insertPayload.proof_url) {
    throw createHttpError('PROOF_REQUIRED', 400);
  }

  if (normalizedMethod === 'stripe') {
    const intent = await createStripeIntent({
      amount: amountNumber,
      currency: insertPayload.currency,
      metadata: { userId, wallet: normalizedWallet },
    });
    insertPayload.payment_intent_id = intent.id;
    insertPayload.payment_intent_secret = intent.client_secret || null;
  }

  const inserted = await db('fiat_deposits').insert(insertPayload);
  const depositId = resolveInsertId(inserted);
  const row = await db('fiat_deposits').where({ id: depositId }).first();
  return serializeDeposit(row);
}

export async function listUserFiatDeposits(userId, { status } = {}) {
  if (!userId) throw createHttpError('USER_REQUIRED', 400);
  const query = db('fiat_deposits').where({ user_id: userId }).orderBy('created_at', 'desc');
  if (status) {
    query.where({ status: status.toLowerCase() });
  }
  const rows = await query;
  return rows.map((row) => serializeDeposit(row));
}

export async function adminListFiatDeposits({ status, method, userId } = {}) {
  const query = db('fiat_deposits as fd')
    .leftJoin('users as u', 'fd.user_id', 'u.id')
    .select('fd.*', 'u.email as user_email')
    .orderBy('fd.created_at', 'desc');
  if (status) query.where('fd.status', status.toLowerCase());
  if (method) query.where('fd.method', method.toLowerCase());
  if (userId) query.where('fd.user_id', Number(userId));
  const rows = await query;
  return rows.map((row) => ({
    ...serializeDeposit(row),
    user: row.user_email
      ? {
          id: row.user_id,
          email: row.user_email,
        }
      : null,
  }));
}

export async function adminReviewFiatDeposit({ depositId, action, reviewerId, notes }) {
  const row = await db('fiat_deposits').where({ id: depositId }).first();
  if (!row) throw createHttpError('DEPOSIT_NOT_FOUND', 404);
  if (!['requires_payment', 'pending_review'].includes(row.status)) {
    throw createHttpError('DEPOSIT_ALREADY_REVIEWED', 400);
  }
  const normalizedAction = String(action || '').toLowerCase();
  if (!['approve', 'reject'].includes(normalizedAction)) {
    throw createHttpError('INVALID_ACTION', 400);
  }

  if (normalizedAction === 'reject') {
    await rejectFiatDeposit(row, { reviewerId, notes });
    return serializeDeposit(await db('fiat_deposits').where({ id: depositId }).first());
  }

  await approveFiatDeposit(row, { reviewerId, notes });
  const updated = await db('fiat_deposits').where({ id: depositId }).first();
  return serializeDeposit(updated);
}

function buildFundingUrls() {
  const base = cfg?.ui?.appBaseUrl || 'http://localhost:5173/app';
  const normalized = base.replace(/\/+$/, '');
  return {
    success: `${normalized}/funding?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${normalized}/funding?checkout=cancel`,
  };
}

export async function createFiatCheckoutSession({
  userId,
  amount,
  currency = 'USD',
  wallet = 'spot',
  reference,
}) {
  if (!userId) throw createHttpError('USER_REQUIRED', 400);
  const normalizedWallet = normalizeWallet(wallet);
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    throw createHttpError('INVALID_AMOUNT', 400);
  }
  const currencyCode = String(currency || 'USD').toUpperCase();
  const { cents } = toMinorUnits(amountNumber, currencyCode);
  const { success, cancel } = buildFundingUrls();
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', success);
  params.append('cancel_url', cancel);
  params.append('line_items[0][price_data][currency]', currencyCode.toLowerCase());
  params.append('line_items[0][price_data][product_data][name]', `USD Funding (${wallet})`);
  params.append('line_items[0][price_data][unit_amount]', String(cents));
  params.append('line_items[0][quantity]', '1');
  params.append('metadata[userId]', String(userId));
  params.append('metadata[wallet]', normalizedWallet);
  if (reference) params.append('metadata[reference]', reference);

  const session = await stripeRequest('/checkout/sessions', { params });
  if (!session?.url) {
    throw createHttpError('STRIPE_CHECKOUT_URL_MISSING', 500);
  }

  const inserted = await db('fiat_deposits').insert({
    user_id: userId,
    method: 'stripe_checkout',
    status: 'requires_payment',
    wallet: normalizedWallet,
    amount: amountNumber.toFixed(2),
    currency: currencyCode,
    reference: session.id,
    payment_intent_id: session.payment_intent || null,
    meta: JSON.stringify({
      checkoutUrl: session.url,
      sessionId: session.id,
    }),
    created_at: new Date(),
    updated_at: new Date(),
  });
  const depositId = resolveInsertId(inserted);
  const depositRow = await db('fiat_deposits').where({ id: depositId }).first();
  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    deposit: serializeDeposit(depositRow),
  };
}

export async function verifyCheckoutSession({ userId, sessionId }) {
  if (!userId) throw createHttpError('USER_REQUIRED', 400);
  if (!sessionId) throw createHttpError('SESSION_ID_REQUIRED', 400);
  const row = await db('fiat_deposits')
    .where({ user_id: userId, method: 'stripe_checkout', reference: sessionId })
    .first();
  if (!row) throw createHttpError('CHECKOUT_SESSION_NOT_FOUND', 404);

  const session = await stripeRequest(`/checkout/sessions/${sessionId}`, { method: 'GET' });
  const updated = await reconcileCheckoutSession(row, session);
  return {
    session: {
      id: session.id,
      paymentStatus: session.payment_status,
      status: session.status,
      amountTotal: session.amount_total,
      currency: session.currency,
    },
    deposit: serializeDeposit(updated),
  };
}

export async function processCheckoutSessionWebhook(session) {
  if (!session?.id) return null;
  const row = await db('fiat_deposits')
    .where({ method: 'stripe_checkout', reference: session.id })
    .first();
  if (!row) return null;
  const updated = await reconcileCheckoutSession(row, session);
  return serializeDeposit(updated);
}

async function reconcileCheckoutSession(row, session) {
  const paymentStatus = session?.payment_status;
  if (paymentStatus === 'paid' && row.status === 'requires_payment') {
    await approveFiatDeposit(row, { reviewerId: null, notes: 'stripe_checkout_auto' });
    await db('fiat_deposits')
      .where({ id: row.id })
      .update({
        payment_intent_id: session.payment_intent || row.payment_intent_id,
        meta: JSON.stringify({
          ...(row.meta ? parseMetaSafe(row.meta) : {}),
          sessionId: session.id,
          checkoutData: session,
        }),
      });
  } else if (
    (session?.status === 'expired' || paymentStatus === 'canceled') &&
    row.status === 'requires_payment'
  ) {
    await cancelFiatDeposit(row, 'canceled', 'Checkout session expired');
  }
  return db('fiat_deposits').where({ id: row.id }).first();
}

function parseMetaSafe(meta) {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

function isStripeMethod(row) {
  const method = String(row?.method || '').toLowerCase();
  return method === 'stripe' || method === 'stripe_checkout';
}

async function notifyStripeDepositSuccess(row) {
  if (!isStripeMethod(row)) return;
  const contact = await getUserContact(row.user_id);
  if (!contact?.email) return;
  try {
    await sendStripeDepositSuccessEmail({
      to: contact.email,
      name: contact.name,
      amount: Number(row.amount || 0).toFixed(2),
      currency: row.currency,
      wallet: row.wallet,
      reference: row.reference || row.payment_intent_id || row.id,
    });
  } catch (err) {
    console.error('[mail] stripe success email failed', err.message);
  }
}

async function notifyStripeDepositFailure(row, { status, reason }) {
  if (!isStripeMethod(row)) return;
  const contact = await getUserContact(row.user_id);
  if (!contact?.email) return;
  try {
    await sendStripeDepositFailureEmail({
      to: contact.email,
      name: contact.name,
      amount: Number(row.amount || 0).toFixed(2),
      currency: row.currency,
      status,
      reason: reason || status,
    });
  } catch (err) {
    console.error('[mail] stripe failure email failed', err.message);
  }
}

async function approveFiatDeposit(row, { reviewerId, notes } = {}) {
  const namespace = WALLET_NAMESPACE[row.wallet] || WALLET_NAMESPACE.spot;
  const amountBig = parseUnits(Number(row.amount).toString(), 18);
  const now = new Date();
  await withTx(async (trx) => {
    await journal(
      trx,
      [
        {
          account: { userId: null, namespace: FIAT_CLEARING_NAMESPACE, asset: CREDIT_ASSET },
          amount: -amountBig,
          meta: { reason: 'fiat_deposit', depositId: row.id },
        },
        {
          account: { userId: row.user_id, namespace, asset: CREDIT_ASSET },
          amount: amountBig,
          meta: { reason: 'fiat_deposit', depositId: row.id },
        },
      ],
      {
        description: `Fiat deposit approval ${row.currency}`,
        meta: { depositId: row.id, reviewerId },
      }
    );

    await trx('fiat_deposits')
      .where({ id: row.id })
      .update({
        status: 'approved',
        reviewer_id: reviewerId || null,
        reviewed_at: now,
        review_notes: notes || null,
        updated_at: now,
      });
  });

  await notifyStripeDepositSuccess(row);
}

async function rejectFiatDeposit(row, { reviewerId, notes } = {}) {
  const now = new Date();
  await db('fiat_deposits')
    .where({ id: row.id })
    .update({
      status: 'rejected',
      reviewer_id: reviewerId || null,
      reviewed_at: now,
      review_notes: notes || null,
      updated_at: now,
    });

  await notifyStripeDepositFailure(row, {
    status: 'rejected',
    reason: notes || 'Deposit rejected',
  });
}

async function cancelFiatDeposit(row, status = 'canceled', reason = 'Canceled') {
  await db('fiat_deposits')
    .where({ id: row.id })
    .update({
      status,
      updated_at: new Date(),
    });

  await notifyStripeDepositFailure(row, {
    status,
    reason,
  });
}
