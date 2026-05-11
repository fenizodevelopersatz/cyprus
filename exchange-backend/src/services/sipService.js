import { parseUnits, formatUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { allowedSpotSymbols, isSpotSymbolAllowed } from '../utils/symbols.js';
import { getSettings } from './settingsService.js';
import * as marketService from './marketService.js';
import { getAccountBalance, journal } from './ledgerService.js';

const CONTRIBUTION_TYPES = ['AMOUNT', 'QUANTITY'];
const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];
const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELED'];
const ORDER_STATUSES = ['QUEUED', 'EXECUTED', 'SKIPPED', 'FAILED'];
const DEFAULT_QUOTE_ASSET = 'USDT';
const SIP_RESERVE_NAMESPACE = 'sip:reserved';

function resolveInsertId(result) {
  if (Array.isArray(result)) {
    const value = result[0];
    if (value && typeof value === 'object') {
      return value.id ?? value.ID ?? Object.values(value)[0];
    }
    return value;
  }
  if (result && typeof result === 'object') {
    return result.id ?? result.ID ?? Object.values(result)[0];
  }
  return result;
}

function normalizeAsset(asset) {
  const upper = String(asset || '').trim().toUpperCase();
  if (!upper) throw new Error('ASSET_REQUIRED');
  const base = upper.endsWith('USDT') ? upper.slice(0, -4) : upper;
  const symbol = `${base}USDT`;
  if (!isSpotSymbolAllowed(symbol)) {
    const err = new Error('ASSET_NOT_ALLOWED');
    err.status = 400;
    throw err;
  }
  return base;
}

function normalizeQuoteCurrency(value, settings) {
  const upper = String(value || settings?.sipSupportedFiats?.[0] || '').trim().toUpperCase();
  if (!upper) throw new Error('QUOTE_CURRENCY_REQUIRED');
  const supported = settings?.sipSupportedFiats || ['USD'];
  if (!supported.includes(upper)) {
    const err = new Error('QUOTE_CURRENCY_NOT_SUPPORTED');
    err.status = 400;
    throw err;
  }
  return upper;
}

function normalizeContributionType(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (!CONTRIBUTION_TYPES.includes(upper)) {
    const err = new Error('CONTRIBUTION_TYPE_INVALID');
    err.status = 400;
    throw err;
  }
  return upper;
}

function normalizeFrequency(value, allowed) {
  const upper = String(value || '').trim().toUpperCase();
  const accepted = allowed && allowed.length ? allowed : FREQUENCIES;
  if (!accepted.includes(upper)) {
    const err = new Error('FREQUENCY_NOT_ALLOWED');
    err.status = 400;
    throw err;
  }
  return upper;
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function cleanDecimal(value, decimals = 18) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

function hydratePlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    asset: row.asset,
    quoteCurrency: row.quote_currency,
    nickname: row.nickname,
    description: row.description || null,
    status: row.status,
    minFiatAmount: cleanDecimal(row.min_fiat_amount, 4),
    maxFiatAmount: cleanDecimal(row.max_fiat_amount, 4),
    minAssetQuantity: cleanDecimal(row.min_asset_quantity),
    maxAssetQuantity: cleanDecimal(row.max_asset_quantity),
    allowedFrequencies: parseJsonField(row.allowed_frequencies, null),
    allowAmountInput: !!row.allow_amount_input,
    allowQuantityInput: !!row.allow_quantity_input,
    sortOrder: row.sort_order || 0,
    meta: parseJsonField(row.meta, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydrateSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    asset: row.asset,
    quoteCurrency: row.quote_currency,
    contributionType: row.contribution_type,
    amountFiat: cleanDecimal(row.amount_fiat, 4),
    amountAsset: cleanDecimal(row.amount_asset),
    frequency: row.frequency,
    startAt: row.start_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    status: row.status,
    failCount: row.fail_count || 0,
    autoPauseOnFail: !!row.auto_pause_on_fail,
    walletSource: row.wallet_source,
    meta: parseJsonField(row.meta, null),
    reserveAsset: row.reserve_asset || null,
    reserveAmount: cleanDecimal(row.reserve_amount),
    reserveBalance: cleanDecimal(row.reserve_balance),
    reserveStatus: row.reserve_status || null,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: row.plan_id
      ? {
          id: row.plan_id,
          nickname: row.plan_nickname || null,
          asset: row.plan_asset || null,
          quoteCurrency: row.plan_quote_currency || null,
        }
      : null,
  };
}

function hydrateOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    asset: row.asset,
    quoteCurrency: row.quote_currency,
    scheduledAmountFiat: cleanDecimal(row.scheduled_amount_fiat, 4),
    scheduledAmountAsset: cleanDecimal(row.scheduled_amount_asset),
    executedAmountAsset: cleanDecimal(row.executed_amount_asset),
    priceUsed: cleanDecimal(row.price_used, 8),
    scheduledFor: row.scheduled_for,
    executedAt: row.executed_at,
    status: row.status,
    failureReason: row.failure_reason || null,
    journalId: row.journal_id || null,
    meta: parseJsonField(row.meta, null),
    createdAt: row.created_at,
  };
}

function upperList(value) {
  if (!value) return [];
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [value])
        .map((item) => String(item || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function calculateNextRun(base, frequency) {
  const next = new Date(base);
  switch (frequency) {
    case 'HOURLY':
      next.setHours(next.getHours() + 1);
      break;
    case 'DAILY':
      next.setDate(next.getDate() + 1);
      break;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7);
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      next.setDate(next.getDate() + 1);
  }
  return next;
}

async function priceMapForAssets(assets) {
  if (!assets?.length) return {};
  const symbols = assets
    .map((asset) => `${asset}USDT`)
    .filter((symbol) => isSpotSymbolAllowed(symbol));
  if (!symbols.length) return {};
  const snapshots = await marketService.tickers({ symbols });
  const map = {};
  for (const snap of snapshots) {
    map[snap.baseAsset] = Number(snap.last || 0);
  }
  return map;
}

function parseBaseFromSymbol(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  return upper.endsWith('USDT') ? upper.slice(0, -4) : upper;
}

function quoteAssetForCurrency(currency) {
  const upper = String(currency || 'USD').toUpperCase();
  if (upper === 'USD') return DEFAULT_QUOTE_ASSET;
  if (upper === 'USDT') return 'USDT';
  if (upper === 'USDC') return 'USDC';
  return DEFAULT_QUOTE_ASSET;
}

async function buildWalletCheck({ userId, walletSource, quoteAsset, requiredQuote }) {
  if (!userId || !walletSource || !quoteAsset || !requiredQuote || requiredQuote <= 0) {
    return null;
  }
  try {
    const requiredBig = parseUnits(requiredQuote.toFixed(18), 18);
    const availableBig = await getAccountBalance({
      userId,
      namespace: walletSource,
      asset: quoteAsset,
    });
    return {
      asset: quoteAsset,
      available: formatUnits(availableBig, 18),
      required: formatUnits(requiredBig, 18),
      sufficient: availableBig >= requiredBig,
    };
  } catch (err) {
    console.warn('[sip] wallet check failed', err.message);
    return null;
  }
}

function toReserveBig(amount) {
  if (amount === null || amount === undefined) return 0n;
  return parseUnits(String(amount), 18);
}

async function lockReserve({
  userId,
  walletSource,
  asset,
  amount,
  subscriptionId,
  trx,
}) {
  const amountBig = toReserveBig(amount);
  if (amountBig <= 0n) return;
  const balance = await getAccountBalance({ userId, namespace: walletSource, asset }, trx);
  if (balance < amountBig) {
    const err = new Error('INSUFFICIENT_FUNDS');
    err.status = 400;
    throw err;
  }
  await journal(
    trx,
    [
      {
        account: { userId, namespace: walletSource, asset },
        amount: -amountBig,
        meta: { reason: 'sip_reserve', subscriptionId },
      },
      {
        account: { userId, namespace: SIP_RESERVE_NAMESPACE, asset },
        amount: amountBig,
        meta: { reason: 'sip_reserve', subscriptionId },
      },
    ],
    {
      description: `SIP reserve ${asset}`,
      meta: { subscriptionId, walletSource },
    }
  );
}

async function releaseReserve({
  userId,
  walletSource,
  asset,
  amount,
  subscriptionId,
  trx,
}) {
  const amountBig = toReserveBig(amount);
  if (amountBig <= 0n) return;
  await journal(
    trx,
    [
      {
        account: { userId, namespace: SIP_RESERVE_NAMESPACE, asset },
        amount: -amountBig,
        meta: { reason: 'sip_release', subscriptionId },
      },
      {
        account: { userId, namespace: walletSource, asset },
        amount: amountBig,
        meta: { reason: 'sip_release', subscriptionId },
      },
    ],
    {
      description: `SIP release ${asset}`,
      meta: { subscriptionId, walletSource },
    }
  );
}

async function buildCoinCatalog(settings) {
  const fiatRates = settings.sipFiatExchangeRates || { USD: 1 };
  const uniqueAssets = Array.from(
    new Set(
      (allowedSpotSymbols || [])
        .map((symbol) => parseBaseFromSymbol(symbol))
        .filter(Boolean)
    )
  );
  if (!uniqueAssets.length) return [];
  const usdPrices = await priceMapForAssets(uniqueAssets);
  return uniqueAssets.map((asset) => {
    const usd = usdPrices[asset] || 0;
    const prices = {};
    for (const [fiat, rate] of Object.entries(fiatRates)) {
      prices[fiat] = usd * rate;
    }
    return {
      asset,
      symbol: `${asset}USDT`,
      lastPriceUsd: usd,
      fiatPrices: prices,
    };
  });
}

export async function listPlans({ status, quoteCurrency, includeArchived = false } = {}) {
  const query = db('sip_plans').orderBy('sort_order', 'desc').orderBy('id', 'asc');
  if (status) {
    query.where({ status: status.toUpperCase() });
  } else if (!includeArchived) {
    query.whereNot({ status: 'ARCHIVED' });
  }
  if (quoteCurrency) {
    query.andWhere({ quote_currency: quoteCurrency.toUpperCase() });
  }
  const rows = await query;
  return rows.map(hydratePlan);
}

export async function getPlan(id) {
  const row = await db('sip_plans').where({ id }).first();
  return hydratePlan(row);
}

export async function createPlan(payload) {
  const asset = normalizeAsset(payload.asset);
  const settings = await getSettings();
  const quoteCurrency = normalizeQuoteCurrency(payload.quoteCurrency, settings);
  const nickname = String(payload.nickname || '').trim();
  if (!nickname) {
    const err = new Error('NICKNAME_REQUIRED');
    err.status = 400;
    throw err;
  }
  const allowedFrequencies = upperList(
    payload.allowedFrequencies?.length ? payload.allowedFrequencies : settings.sipAllowedFrequencies
  ).filter((freq) => FREQUENCIES.includes(freq));
  const insertPayload = {
    asset,
    quote_currency: quoteCurrency,
    nickname,
    description: payload.description || null,
    status: String(payload.status || 'ACTIVE').toUpperCase(),
    min_fiat_amount: payload.minFiatAmount ?? settings.sipMinFiatAmount ?? 0,
    max_fiat_amount: payload.maxFiatAmount ?? settings.sipMaxFiatAmount ?? null,
    min_asset_quantity: payload.minAssetQuantity ?? settings.sipMinAssetQuantity ?? null,
    max_asset_quantity: payload.maxAssetQuantity ?? settings.sipMaxAssetQuantity ?? null,
    allowed_frequencies: allowedFrequencies.length ? JSON.stringify(allowedFrequencies) : null,
    allow_amount_input: payload.allowAmountInput !== false,
    allow_quantity_input: payload.allowQuantityInput !== false,
    sort_order: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
    meta: serializeJson(payload.meta),
    created_at: new Date(),
    updated_at: new Date(),
  };
  const inserted = await db('sip_plans').insert(insertPayload);
  const id = resolveInsertId(inserted);
  return getPlan(id);
}

export async function updatePlan(id, patch = {}) {
  const plan = await db('sip_plans').where({ id }).first();
  if (!plan) {
    const err = new Error('PLAN_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  const settings = await getSettings();
  const update = {};
  if (patch.asset !== undefined) update.asset = normalizeAsset(patch.asset);
  if (patch.quoteCurrency !== undefined) {
    update.quote_currency = normalizeQuoteCurrency(patch.quoteCurrency, settings);
  }
  if (patch.nickname !== undefined) update.nickname = String(patch.nickname || '').trim();
  if (patch.description !== undefined) update.description = patch.description || null;
  if (patch.status !== undefined) update.status = String(patch.status || '').toUpperCase();
  if (patch.minFiatAmount !== undefined) update.min_fiat_amount = patch.minFiatAmount;
  if (patch.maxFiatAmount !== undefined) update.max_fiat_amount = patch.maxFiatAmount;
  if (patch.minAssetQuantity !== undefined) update.min_asset_quantity = patch.minAssetQuantity;
  if (patch.maxAssetQuantity !== undefined) update.max_asset_quantity = patch.maxAssetQuantity;
  if (patch.allowAmountInput !== undefined) update.allow_amount_input = !!patch.allowAmountInput;
  if (patch.allowQuantityInput !== undefined)
    update.allow_quantity_input = !!patch.allowQuantityInput;
  if (patch.sortOrder !== undefined) update.sort_order = Number(patch.sortOrder) || 0;
  if (patch.allowedFrequencies !== undefined) {
    const freq = upperList(patch.allowedFrequencies).filter((item) => FREQUENCIES.includes(item));
    update.allowed_frequencies = freq.length ? JSON.stringify(freq) : null;
  }
  if (patch.meta !== undefined) update.meta = serializeJson(patch.meta);
  if (!Object.keys(update).length) return hydratePlan(plan);
  update.updated_at = new Date();
  await db('sip_plans').where({ id }).update(update);
  return getPlan(id);
}

async function assertPlanSupports(plan, settings, { contributionType, frequency }) {
  if (!plan || plan.status !== 'ACTIVE') {
    const err = new Error('PLAN_NOT_ACTIVE');
    err.status = 400;
    throw err;
  }
  const allowedFrequencies = plan.allowedFrequencies?.length
    ? plan.allowedFrequencies
    : settings.sipAllowedFrequencies;
  normalizeFrequency(frequency, allowedFrequencies);
  if (contributionType === 'AMOUNT' && plan.allowAmountInput === false) {
    const err = new Error('PLAN_DISALLOWS_AMOUNT');
    err.status = 400;
    throw err;
  }
  if (contributionType === 'QUANTITY' && plan.allowQuantityInput === false) {
    const err = new Error('PLAN_DISALLOWS_QUANTITY');
    err.status = 400;
    throw err;
  }
}

function ensureWithinLimits(value, { min, max, codeMin, codeMax }) {
  if (min !== null && min !== undefined && Number(value) < Number(min)) {
    const err = new Error(codeMin || 'AMOUNT_BELOW_MIN');
    err.status = 400;
    throw err;
  }
  if (max !== null && max !== undefined && Number(max) > 0 && Number(value) > Number(max)) {
    const err = new Error(codeMax || 'AMOUNT_ABOVE_MAX');
    err.status = 400;
    throw err;
  }
}

function resolveStartDate(input, settings) {
  if (input) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      const err = new Error('INVALID_START_AT');
      err.status = 400;
      throw err;
    }
    return date;
  }
  const now = new Date();
  const buffer = Number(settings.sipDefaultStartBufferMinutes || 5);
  return addMinutes(now, buffer);
}

function resolveWalletSource(input, settings) {
  return input || settings.sipDefaultWalletSource || 'spot:available';
}

function convertToNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    const err = new Error('AMOUNT_INVALID');
    err.status = 400;
    throw err;
  }
  return numeric;
}

export async function previewContribution(
  { planId, asset, quoteCurrency, contributionType, amountFiat, amountAsset, frequency },
  { userId, walletSource } = {}
) {
  const settings = await getSettings();
  const plan = planId ? await getPlan(planId) : null;
  if (planId && !plan) {
    const err = new Error('PLAN_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  const normalizedAsset = normalizeAsset(asset || plan?.asset);
  if (!asset && !plan) {
    const err = new Error('ASSET_REQUIRED');
    err.status = 400;
    throw err;
  }
  if (plan && normalizedAsset !== plan.asset) {
    const err = new Error('PLAN_ASSET_MISMATCH');
    err.status = 400;
    throw err;
  }
  const normalizedQuote = normalizeQuoteCurrency(
    plan ? plan.quoteCurrency : quoteCurrency,
    settings
  );
  const normalizedType = normalizeContributionType(contributionType);
  const allowedFreq = plan?.allowedFrequencies?.length
    ? plan.allowedFrequencies
    : settings.sipAllowedFrequencies;
  const normalizedFrequency = normalizeFrequency(frequency || settings.sipDefaultFrequency, allowedFreq);

  if (plan) {
    await assertPlanSupports(plan, settings, {
      contributionType: normalizedType,
      frequency: normalizedFrequency,
    });
  }

  const priceUsdMap = await priceMapForAssets([normalizedAsset]);
  const assetUsd = priceUsdMap[normalizedAsset] || 0;
  const fiatRates = settings.sipFiatExchangeRates || { USD: 1 };
  const fiatRate = fiatRates[normalizedQuote] || 1;
  const assetFiatPrice = assetUsd * fiatRate;

  if (!assetFiatPrice || assetFiatPrice <= 0) {
    const err = new Error('PRICE_UNAVAILABLE');
    err.status = 400;
    throw err;
  }

  let resolvedFiat = null;
  let resolvedAsset = null;

  if (normalizedType === 'AMOUNT') {
    const numeric = convertToNumber(amountFiat);
    ensureWithinLimits(numeric, {
      min: plan?.minFiatAmount ?? settings.sipMinFiatAmount,
      max: plan?.maxFiatAmount ?? settings.sipMaxFiatAmount,
      codeMin: 'FIAT_BELOW_MIN',
      codeMax: 'FIAT_ABOVE_MAX',
    });
    resolvedFiat = numeric;
    resolvedAsset = numeric / assetFiatPrice;
    ensureWithinLimits(resolvedAsset, {
      min: plan?.minAssetQuantity ?? settings.sipMinAssetQuantity,
      max: plan?.maxAssetQuantity ?? settings.sipMaxAssetQuantity,
      codeMin: 'ASSET_BELOW_MIN',
      codeMax: 'ASSET_ABOVE_MAX',
    });
  } else {
    const numeric = convertToNumber(amountAsset);
    ensureWithinLimits(numeric, {
      min: plan?.minAssetQuantity ?? settings.sipMinAssetQuantity,
      max: plan?.maxAssetQuantity ?? settings.sipMaxAssetQuantity,
      codeMin: 'ASSET_BELOW_MIN',
      codeMax: 'ASSET_ABOVE_MAX',
    });
    resolvedAsset = numeric;
    resolvedFiat = numeric * assetFiatPrice;
    const minFiat = plan?.minFiatAmount ?? null;
    const maxFiat = plan?.maxFiatAmount ?? null;
    if (minFiat != null || maxFiat != null) {
      ensureWithinLimits(resolvedFiat, {
        min: minFiat,
        max: maxFiat,
        codeMin: 'FIAT_BELOW_MIN',
        codeMax: 'FIAT_ABOVE_MAX',
      });
    }
  }

  const limits = {
    minFiat:
      normalizedType === 'AMOUNT'
        ? plan?.minFiatAmount ?? settings.sipMinFiatAmount ?? null
        : plan?.minFiatAmount ?? null,
    maxFiat:
      normalizedType === 'AMOUNT'
        ? plan?.maxFiatAmount ?? settings.sipMaxFiatAmount ?? null
        : plan?.maxFiatAmount ?? null,
    minAsset: plan?.minAssetQuantity ?? settings.sipMinAssetQuantity ?? null,
    maxAsset: plan?.maxAssetQuantity ?? settings.sipMaxAssetQuantity ?? null,
  };
  const quoteAsset = quoteAssetForCurrency(normalizedQuote);
  const reserveAssetAmount = resolvedFiat / fiatRate;
  const walletCheck = await buildWalletCheck({
    userId,
    walletSource,
    quoteAsset,
    requiredQuote: resolvedFiat,
  });

  return {
    plan,
    asset: normalizedAsset,
    quoteCurrency: normalizedQuote,
    contributionType: normalizedType,
    frequency: normalizedFrequency,
    amountFiat: resolvedFiat.toFixed(2),
    amountAsset: cleanDecimal(resolvedAsset),
    assetPriceFiat: assetFiatPrice,
    limits,
    walletCheck,
    reserveAsset: quoteAsset,
    reserveAssetAmount: cleanDecimal(reserveAssetAmount),
  };
}

export async function createSubscription(payload, { userId }) {
  if (!userId) throw new Error('USER_REQUIRED');
  const settings = await getSettings();
  const resolvedWalletSource = payload.walletSource || settings.sipDefaultWalletSource;
  const preview = await previewContribution(
    { ...payload, walletSource: resolvedWalletSource },
    {
      userId,
      walletSource: resolvedWalletSource,
    }
  );
  if (preview.walletCheck && preview.walletCheck.sufficient === false) {
    const err = new Error('INSUFFICIENT_FUNDS');
    err.status = 400;
    err.meta = preview.walletCheck;
    throw err;
  }
  const startAt = resolveStartDate(payload.startAt, settings);
  const nextRunAt = startAt;
  let subscriptionId;
  await withTx(async (trx) => {
    const insertPayload = {
      user_id: userId,
      plan_id: payload.planId || null,
      asset: preview.asset,
      quote_currency: preview.quoteCurrency,
      contribution_type: preview.contributionType,
      amount_fiat: preview.amountFiat,
      amount_asset: preview.amountAsset,
      frequency: preview.frequency,
      start_at: startAt,
      next_run_at: nextRunAt,
      status: 'ACTIVE',
      fail_count: 0,
      auto_pause_on_fail:
        payload.autoPauseOnFail !== undefined ? !!payload.autoPauseOnFail : true,
      wallet_source: resolveWalletSource(resolvedWalletSource, settings),
      meta: serializeJson(payload.meta),
      reserve_asset: preview.reserveAsset,
      reserve_amount: preview.reserveAssetAmount,
      reserve_balance: '0',
      reserve_status: 'PENDING',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const inserted = await trx('sip_subscriptions').insert(insertPayload);
    subscriptionId = resolveInsertId(inserted);
    await lockReserve({
      userId,
      walletSource: resolveWalletSource(resolvedWalletSource, settings),
      asset: preview.reserveAsset,
      amount: preview.reserveAssetAmount,
      subscriptionId,
      trx,
    });
    await trx('sip_subscriptions')
      .where({ id: subscriptionId })
      .update({
        reserve_balance: preview.reserveAssetAmount,
        reserve_status: 'HEALTHY',
        updated_at: new Date(),
      });
  });
  const row = await db('sip_subscriptions as s')
    .leftJoin('sip_plans as p', 's.plan_id', 'p.id')
    .select(
      's.*',
      'p.nickname as plan_nickname',
      'p.asset as plan_asset',
      'p.quote_currency as plan_quote_currency'
    )
    .where('s.id', subscriptionId)
    .first();
  return hydrateSubscription(row);
}

export async function listSubscriptions({ userId, status, planId } = {}) {
  const query = db('sip_subscriptions as s')
    .leftJoin('sip_plans as p', 's.plan_id', 'p.id')
    .select(
      's.*',
      'p.nickname as plan_nickname',
      'p.asset as plan_asset',
      'p.quote_currency as plan_quote_currency'
    )
    .orderBy('s.created_at', 'desc');
  if (userId) query.where('s.user_id', userId);
  if (status) query.where('s.status', status.toUpperCase());
  if (planId) query.where('s.plan_id', planId);
  const rows = await query;
  return rows.map(hydrateSubscription);
}

export async function getSubscriptionById(id, { userId } = {}) {
  const query = db('sip_subscriptions as s')
    .leftJoin('sip_plans as p', 's.plan_id', 'p.id')
    .select(
      's.*',
      'p.nickname as plan_nickname',
      'p.asset as plan_asset',
      'p.quote_currency as plan_quote_currency'
    )
    .where('s.id', id);
  if (userId) query.andWhere('s.user_id', userId);
  const row = await query.first();
  return hydrateSubscription(row);
}

export async function updateSubscriptionStatus(id, action, { actorId, userId } = {}) {
  const subscription = await getSubscriptionById(id, { userId });
  if (!subscription) {
    const err = new Error('SUBSCRIPTION_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  const now = new Date();
  const normalizedAction = String(action || '').trim().toUpperCase();
  let status = subscription.status;
  if (normalizedAction === 'PAUSE') status = 'PAUSED';
  if (normalizedAction === 'RESUME') status = 'ACTIVE';
  if (normalizedAction === 'CANCEL') status = 'CANCELED';
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    const err = new Error('ACTION_NOT_SUPPORTED');
    err.status = 400;
    throw err;
  }
  let updatedRow;
  await withTx(async (trx) => {
    const update = {
      status,
      updated_at: now,
    };
    const walletSource = subscription.walletSource || 'spot:available';
    if (['PAUSED', 'CANCELED'].includes(status)) {
      if (Number(subscription.reserveBalance || 0) > 0) {
        await releaseReserve({
          userId: subscription.userId,
          walletSource,
          asset: subscription.reserveAsset || quoteAssetForCurrency(subscription.quoteCurrency),
          amount: subscription.reserveBalance || subscription.reserveAmount,
          subscriptionId: subscription.id,
          trx,
        });
        update.reserve_balance = '0';
        update.reserve_status = status === 'CANCELED' ? 'CANCELED' : 'PAUSED';
      }
    }
    if (status === 'ACTIVE' && normalizedAction === 'RESUME') {
      await lockReserve({
        userId: subscription.userId,
        walletSource,
        asset: subscription.reserveAsset || quoteAssetForCurrency(subscription.quoteCurrency),
        amount: subscription.reserveAmount || subscription.amountFiat,
        subscriptionId: subscription.id,
        trx,
      });
      update.reserve_balance = subscription.reserveAmount || subscription.amountFiat;
      update.reserve_status = 'HEALTHY';
    }
    if (status === 'ACTIVE') {
      const settings = await getSettings();
      const buffer = Number(settings?.sipDefaultStartBufferMinutes || 5);
      update.next_run_at = addMinutes(now, buffer);
    }
    if (status === 'CANCELED') {
      update.canceled_at = now;
    }
    await trx('sip_subscriptions').where({ id: subscription.id }).update(update);
    updatedRow = await trx('sip_subscriptions as s')
      .leftJoin('sip_plans as p', 's.plan_id', 'p.id')
      .select(
        's.*',
        'p.nickname as plan_nickname',
        'p.asset as plan_asset',
        'p.quote_currency as plan_quote_currency'
      )
      .where('s.id', subscription.id)
      .first();
  });
  return hydrateSubscription(updatedRow);
}

export async function listOrders({ userId, subscriptionId, status, limit = 50 } = {}) {
  const query = db('sip_orders').orderBy('scheduled_for', 'desc');
  if (userId) query.where({ user_id: userId });
  if (subscriptionId) query.where({ subscription_id: subscriptionId });
  if (status) query.where({ status: status.toUpperCase() });
  query.limit(Math.min(Math.max(Number(limit) || 10, 1), 200));
  const rows = await query;
  return rows.map(hydrateOrder);
}

export async function getCatalog() {
  const settings = await getSettings();
  if (!settings.sipEnabled) {
    return {
      enabled: false,
      hero: settings.sipHero || null,
      settings: {
        supportedFiats: settings.sipSupportedFiats || ['USD'],
      },
      plans: [],
      coins: [],
    };
  }
  const plans = await listPlans({ status: 'ACTIVE', includeArchived: false });
  const assets = Array.from(new Set(plans.map((plan) => plan.asset)));
  const priceUsdMap = await priceMapForAssets(assets);
  const fiatRates = settings.sipFiatExchangeRates || { USD: 1 };
  const payloadPlans = plans.map((plan) => {
    const usd = priceUsdMap[plan.asset] || 0;
    const rate = fiatRates[plan.quoteCurrency] || 1;
    return {
      ...plan,
      lastPriceFiat: usd * rate,
    };
  });
  const coins = await buildCoinCatalog(settings);
  return {
    enabled: true,
    hero: settings.sipHero || null,
    settings: {
      supportedFiats: settings.sipSupportedFiats || ['USD'],
      defaultFrequency: settings.sipDefaultFrequency || 'DAILY',
      scheduleOptions: settings.sipAllowedFrequencies || FREQUENCIES,
      minFiatAmount: settings.sipMinFiatAmount,
      maxFiatAmount: settings.sipMaxFiatAmount,
      minAssetQuantity: settings.sipMinAssetQuantity,
      maxAssetQuantity: settings.sipMaxAssetQuantity,
    },
    plans: payloadPlans,
    coins,
  };
}

export async function recentOrdersForUser(userId, limit = 10) {
  if (!userId) throw new Error('USER_REQUIRED');
  return listOrders({ userId, limit });
}

export async function getUserSipLiabilities(userId) {
  if (!userId) return [];
  const rows = await db('sip_subscriptions')
    .select('quote_currency', 'reserve_asset', 'reserve_balance')
    .where({ user_id: userId })
    .andWhere('reserve_balance', '>', 0);
  if (!rows.length) return [];
  const settings = await getSettings();
  const fiatRates = settings.sipFiatExchangeRates || { USD: 1 };
  const aggregates = new Map();
  for (const row of rows) {
    const currency = String(row.quote_currency || 'USD').toUpperCase();
    const asset = String(row.reserve_asset || quoteAssetForCurrency(currency)).toUpperCase();
    const balance = Number(row.reserve_balance || 0);
    if (!Number.isFinite(balance) || balance <= 0) continue;
    const rate = Number(fiatRates[currency] || 1) || 1;
    const amountFiat = balance * rate;
    const key = `${currency}:${asset}`;
    if (!aggregates.has(key)) {
      aggregates.set(key, { currency, asset, amountFiat: 0, amountAsset: 0 });
    }
    const entry = aggregates.get(key);
    entry.amountFiat += amountFiat;
    entry.amountAsset += balance;
  }
  return Array.from(aggregates.values()).map((entry) => ({
    currency: entry.currency,
    asset: entry.asset,
    amountFiat: entry.amountFiat.toFixed(2),
    amountAsset: entry.amountAsset.toFixed(8),
  }));
}
