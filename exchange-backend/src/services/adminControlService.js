import { randomInt } from 'node:crypto';
import { db } from '../db.js';
import { up as ensureControlSystemMigration } from '../../db/migrations/025_control_system_module.js';

const TRADING_FLOW_TABLE = 'control_system_trading_flow_settings';
const TRADE_SLOTS_TABLE = 'trade_slots';
const TRADE_SLOT_BATCHES_TABLE = 'trade_slot_batches';
const PACKAGE_TIERS_TABLE = 'package_tier_settings';
const BIRTHDAY_GIFTS_TABLE = 'birthday_gift_settings';

const DEFAULT_GLOBAL_RULES = {
  investment_per_trade_percent: '1.00',
  daily_percent_per_trade: '0.65',
  signal_validity_minutes: 10,
  telegram_channel_url: null,
  is_active: true,
};

const DEFAULT_TRADE_SLOTS = [
  { slot_name: 'Morning', slot_time: '09:00:00', is_active: true, sort_order: 1 },
  { slot_name: 'Noon', slot_time: '12:00:00', is_active: true, sort_order: 2 },
  { slot_name: 'Afternoon', slot_time: '15:00:00', is_active: true, sort_order: 3 },
  { slot_name: 'Evening', slot_time: '18:00:00', is_active: true, sort_order: 4 },
];

const DEFAULT_PACKAGE_TIERS = [
  { package_name: 'Package 1', min_amount: '100.00', max_amount: '299.00', signals_per_day: 1, required_level_id: null, is_active: true, sort_order: 1 },
  { package_name: 'Package 2', min_amount: '300.00', max_amount: '4999.00', signals_per_day: 2, required_level_id: null, is_active: true, sort_order: 2 },
  { package_name: 'Package 3', min_amount: '5000.00', max_amount: '24999.00', signals_per_day: 3, required_level_id: 1, is_active: true, sort_order: 3 },
  { package_name: 'Package 4', min_amount: '25000.00', max_amount: null, signals_per_day: 4, required_level_id: 2, is_active: true, sort_order: 4 },
];

const DEFAULT_BIRTHDAY_GIFT = [
  {
    minimum_eligible_level: 'Level 3',
    gift_amount: '10.00',
    is_enabled: true,
    is_active: true,
    sort_order: 1,
  },
];

const SLOT_HISTORY_LABELS = {
  '09:00:00': '9',
  '12:00:00': '12',
  '15:00:00': '3',
  '18:00:00': '6',
};

let schemaReadyPromise = null;

function createValidationError(errors) {
  const err = new Error('Validation failed');
  err.status = 400;
  err.code = 'VALIDATION_FAILED';
  err.errors = errors;
  return err;
}

function isDuplicateEntryError(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function parseNonNegativeNumber(value, key, errors) {
  if (isBlank(value)) {
    errors[key] = 'This field is required';
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors[key] = 'This field must be numeric';
    return null;
  }
  if (parsed < 0) {
    errors[key] = 'This field must be greater than or equal to 0';
    return null;
  }
  return parsed;
}

function parseBooleanLike(value, key, errors) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  errors[key] = 'This field must be true or false';
  return null;
}

function parseTelegramUrl(value, key, errors) {
  if (isBlank(value)) return null;
  const raw = String(value).trim();
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    if (!['t.me', 'telegram.me', 'www.t.me', 'www.telegram.me'].includes(hostname)) {
      errors[key] = 'Telegram URL must use t.me or telegram.me';
      return null;
    }
    if (!parsed.pathname || parsed.pathname === '/') {
      errors[key] = 'Telegram URL must include a channel path';
      return null;
    }
    return parsed.toString();
  } catch {
    errors[key] = 'Telegram Channel URL must be a valid URL';
    return null;
  }
}

function normaliseTime(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.test(trimmed)) return null;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function normaliseDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

function normaliseLevelValue(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseRequiredLevelId(value) {
  const normalized = normaliseLevelValue(value);
  if (!normalized || normalized.toLowerCase() === 'none') return null;
  const match = normalized.match(/level\s*(\d+)/i);
  return match ? Number(match[1]) : NaN;
}

function levelIdToLabel(levelId) {
  return levelId === null || levelId === undefined ? 'None' : `Level ${Number(levelId)}`;
}

function mapGlobalRules(row) {
  return {
    id: row.id,
    investmentPerTradePercent: Number(row.investment_per_trade_percent),
    dailyPercentPerTrade: Number(row.daily_percent_per_trade),
    signalValidityMinutes: Number(row.signal_validity_minutes),
    telegramChannelUrl: row.telegram_channel_url || null,
    isActive: Boolean(row.is_active),
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTradeSlot(row) {
  return {
    id: row.id,
    slotName: row.slot_name,
    slotTime: String(row.slot_time).slice(0, 5),
    isEnabled: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
  };
}

function mapPackageTier(row) {
  return {
    id: row.id,
    packageName: row.package_name,
    minAmount: Number(row.min_amount),
    maxAmount: row.max_amount === null ? 'Unlimited' : String(row.max_amount),
    signalsPerDay: Number(row.signals_per_day),
    requiredLevel: levelIdToLabel(row.required_level_id),
    isEnabled: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
  };
}

function mapBirthdayGift(row) {
  return {
    id: row.id,
    isEnabled: Boolean(row.is_enabled),
    minimumEligibleLevel: row.minimum_eligible_level,
    giftAmount: Number(row.gift_amount),
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTradeSlotBatch(row) {
  let tokenHistory = [];
  try {
    if (Array.isArray(row.token_history_json)) tokenHistory = row.token_history_json;
    else if (typeof row.token_history_json === 'string' && row.token_history_json.trim()) tokenHistory = JSON.parse(row.token_history_json);
  } catch {
    tokenHistory = [];
  }

  return {
    id: row.id,
    slotId: row.slot_id,
    slotDate: row.slot_date,
    slotTime: String(row.slot_time).slice(0, 8),
    batchToken: row.batch_token,
    tokenHistory,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTokenHistoryEntry(token, action, changedAt = new Date(), previousToken = null) {
  return {
    token: String(token),
    action,
    changedAt: changedAt instanceof Date ? changedAt.toISOString() : new Date(changedAt).toISOString(),
    previousToken: previousToken ? String(previousToken) : null,
  };
}

function parseTokenHistory(raw) {
  try {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) return JSON.parse(raw);
  } catch {
    return [];
  }
  return [];
}

async function ensureSingletonRow(trx, tableName, defaultValues) {
  const row = await trx(tableName).where({ is_active: true }).orderBy('id', 'asc').first();
  if (row) return row;
  const inserted = await trx(tableName).insert({
    ...defaultValues,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  return trx(tableName).where({ id }).first();
}

async function ensureSeedRows(trx, tableName, defaultRows) {
  const [{ count }] = await trx(tableName).count({ count: '*' });
  if (Number(count || 0) > 0) return;
  await trx(tableName).insert(
    defaultRows.map((row) => ({
      ...row,
      created_at: new Date(),
      updated_at: new Date(),
    }))
  );
}

async function ensureControlSettingsSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureControlSystemMigration(db).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

export async function ensureDefaultControlSettings(trx = db) {
  await ensureControlSettingsSchema();
  await ensureSingletonRow(trx, TRADING_FLOW_TABLE, DEFAULT_GLOBAL_RULES);
  await ensureSeedRows(trx, TRADE_SLOTS_TABLE, DEFAULT_TRADE_SLOTS);
  await ensureSeedRows(trx, PACKAGE_TIERS_TABLE, DEFAULT_PACKAGE_TIERS);
  await ensureSeedRows(trx, BIRTHDAY_GIFTS_TABLE, DEFAULT_BIRTHDAY_GIFT);
}

function validatePayload(payload) {
  const errors = {};
  if (!payload || typeof payload !== 'object') {
    throw createValidationError({ payload: 'Request body is required' });
  }

  const { globalRules, tradeSlots, packageTiers, birthdayGift } = payload;

  if (!globalRules || typeof globalRules !== 'object') {
    errors.globalRules = 'Trading flow settings are required';
  } else {
    const investmentPerTradePercent = parseNonNegativeNumber(globalRules.investmentPerTradePercent, 'investmentPerTradePercent', errors);
    const dailyPercentPerTrade = parseNonNegativeNumber(globalRules.dailyPercentPerTrade, 'dailyPercentPerTrade', errors);
    const signalValidityMinutes = parseNonNegativeNumber(globalRules.signalValidityMinutes, 'signalValidityMinutes', errors);
    const telegramChannelUrl = parseTelegramUrl(globalRules.telegramChannelUrl, 'telegramChannelUrl', errors);
    if (signalValidityMinutes !== null && signalValidityMinutes < 1) {
      errors.signalValidityMinutes = 'Signal validity minutes must be at least 1';
    }
    if (investmentPerTradePercent !== null) globalRules.investmentPerTradePercent = investmentPerTradePercent;
    if (dailyPercentPerTrade !== null) globalRules.dailyPercentPerTrade = dailyPercentPerTrade;
    if (signalValidityMinutes !== null) globalRules.signalValidityMinutes = Math.trunc(signalValidityMinutes);
    globalRules.telegramChannelUrl = telegramChannelUrl;
  }

  if (!Array.isArray(tradeSlots) || tradeSlots.length === 0) {
    errors.tradeSlots = 'At least one trade slot is required';
  } else {
    tradeSlots.forEach((slot, index) => {
      const prefix = `tradeSlots_${index}`;
      if (!slot || typeof slot !== 'object') {
        errors[prefix] = 'Trade slot is invalid';
        return;
      }
      if (isBlank(slot.slotName)) errors[`${prefix}_slotName`] = 'Slot name is required';
      const time = normaliseTime(slot.slotTime);
      if (!time) errors[`${prefix}_slotTime`] = 'Slot time must be a valid time';
      else slot.slotTime = time;
      const isEnabled = parseBooleanLike(slot.isEnabled, `${prefix}_isEnabled`, errors);
      const sortOrder = parseNonNegativeNumber(slot.sortOrder, `${prefix}_sortOrder`, errors);
      if (isEnabled !== null) slot.isEnabled = isEnabled;
      if (sortOrder !== null) slot.sortOrder = Math.trunc(sortOrder);
    });
  }

  if (!Array.isArray(packageTiers) || packageTiers.length === 0) {
    errors.packageTiers = 'At least one package tier is required';
  } else {
    packageTiers.forEach((tier, index) => {
      const prefix = `packageTiers_${index}`;
      if (!tier || typeof tier !== 'object') {
        errors[prefix] = 'Package tier is invalid';
        return;
      }
      if (isBlank(tier.packageName)) errors[`${prefix}_packageName`] = 'Package name is required';
      const minAmount = parseNonNegativeNumber(tier.minAmount, `${prefix}_minAmount`, errors);
      const signalsPerDay = parseNonNegativeNumber(tier.signalsPerDay, `${prefix}_signalsPerDay`, errors);
      if (signalsPerDay !== null && (!Number.isInteger(signalsPerDay) || signalsPerDay < 1)) {
        errors[`${prefix}_signalsPerDay`] = 'Signals per day must be an integer greater than or equal to 1';
      }

      let maxAmount = null;
      if (!isBlank(tier.maxAmount) && String(tier.maxAmount).trim().toLowerCase() !== 'unlimited') {
        maxAmount = Number(tier.maxAmount);
        if (!Number.isFinite(maxAmount)) {
          errors[`${prefix}_maxAmount`] = 'Max amount must be numeric or Unlimited';
        } else if (maxAmount < 0) {
          errors[`${prefix}_maxAmount`] = 'Max amount must be greater than or equal to 0';
        } else if (minAmount !== null && maxAmount < minAmount) {
          errors[`${prefix}_maxAmount`] = 'Max amount must be greater than or equal to min amount';
        }
      }

      const requiredLevelId = parseRequiredLevelId(tier.requiredLevel);
      if (Number.isNaN(requiredLevelId)) {
        errors[`${prefix}_requiredLevel`] = 'Required level must be None or a Level value';
      }

      const isEnabled = parseBooleanLike(tier.isEnabled, `${prefix}_isEnabled`, errors);
      const sortOrder = parseNonNegativeNumber(tier.sortOrder, `${prefix}_sortOrder`, errors);

      if (minAmount !== null) tier.minAmount = minAmount;
      tier.maxAmount = maxAmount;
      if (signalsPerDay !== null && Number.isInteger(signalsPerDay) && signalsPerDay >= 1) tier.signalsPerDay = Math.trunc(signalsPerDay);
      tier.requiredLevelId = requiredLevelId;
      if (isEnabled !== null) tier.isEnabled = isEnabled;
      if (sortOrder !== null) tier.sortOrder = Math.trunc(sortOrder);
    });

    const sortedTiers = packageTiers
      .map((tier, index) => ({ tier, index }))
      .filter(({ tier }) => tier && typeof tier === 'object' && Number.isFinite(Number(tier.minAmount)))
      .sort((a, b) => Number(a.tier.minAmount) - Number(b.tier.minAmount));

    for (let i = 0; i < sortedTiers.length; i += 1) {
      const { tier, index } = sortedTiers[i];
      if (String(tier.packageName).trim().toLowerCase() === 'package 4' && tier.maxAmount !== null) {
        errors[`packageTiers_${index}_maxAmount`] = 'Package 4 max amount must be Unlimited';
      }
      if (i > 0) {
        const previous = sortedTiers[i - 1].tier;
        if (previous.maxAmount === null || Number(tier.minAmount) <= Number(previous.maxAmount)) {
          errors[`packageTiers_${index}_minAmount`] = 'Package ranges must not overlap';
        }
      }
    }
  }

  if (!Array.isArray(birthdayGift) || birthdayGift.length === 0) {
    errors.birthdayGift = 'At least one birthday gift setting is required';
  } else {
    const seenLevels = new Set();
    birthdayGift.forEach((gift, index) => {
      const prefix = `birthdayGift_${index}`;
      if (!gift || typeof gift !== 'object') {
        errors[prefix] = 'Birthday gift row is invalid';
        return;
      }
      const isEnabled = parseBooleanLike(gift.isEnabled, `${prefix}_isEnabled`, errors);
      const level = normaliseLevelValue(gift.minimumEligibleLevel);
      if (isBlank(level)) {
        errors[`${prefix}_minimumEligibleLevel`] = 'Level is required';
      } else {
        const levelId = parseRequiredLevelId(level);
        if (!Number.isFinite(levelId) || Number(levelId) < 3) {
          errors[`${prefix}_minimumEligibleLevel`] = 'Birthday gifts are allowed for Level 3 and above only';
        } else {
          const uniqueKey = level.toLowerCase();
          if (seenLevels.has(uniqueKey)) {
            errors[`${prefix}_minimumEligibleLevel`] = 'Each birthday gift level must be unique';
          }
          seenLevels.add(uniqueKey);
          gift.minimumEligibleLevel = level;
        }
      }
      const giftAmount = parseNonNegativeNumber(gift.giftAmount, `${prefix}_giftAmount`, errors);
      if (isEnabled !== null) gift.isEnabled = isEnabled;
      if (giftAmount !== null) gift.giftAmount = giftAmount;
      if (gift.sortOrder === undefined || gift.sortOrder === null || gift.sortOrder === '') {
        gift.sortOrder = index + 1;
      } else {
        const sortOrder = parseNonNegativeNumber(gift.sortOrder, `${prefix}_sortOrder`, errors);
        if (sortOrder !== null) gift.sortOrder = Math.trunc(sortOrder);
      }
    });
  }

  if (payload.generatedTokens !== undefined) {
    if (!payload.generatedTokens || typeof payload.generatedTokens !== 'object' || Array.isArray(payload.generatedTokens)) {
      errors.generatedTokens = 'Generated tokens payload must be an object map';
    } else {
      Object.entries(payload.generatedTokens).forEach(([slotId, token]) => {
        if (isBlank(token)) return;
        if (!/^\d{10}$/.test(String(token).trim())) {
          errors[`generatedTokens_${slotId}`] = 'Generated token must be a 10-digit string';
        }
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    throw createValidationError(errors);
  }
}

export async function getControlSettings(trx = db) {
  await ensureDefaultControlSettings(trx);
  const [globalRulesRow, tradeSlotRows, packageTierRows, birthdayGiftRows] = await Promise.all([
    trx(TRADING_FLOW_TABLE).where({ is_active: true }).orderBy('id', 'asc').first(),
    trx(TRADE_SLOTS_TABLE).orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]),
    trx(PACKAGE_TIERS_TABLE).orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]),
    trx(BIRTHDAY_GIFTS_TABLE).where({ is_active: true }).orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]),
  ]);

  return {
    globalRules: mapGlobalRules(globalRulesRow),
    tradeSlots: tradeSlotRows.map(mapTradeSlot),
    packageTiers: packageTierRows.map(mapPackageTier),
    birthdayGift: birthdayGiftRows.map(mapBirthdayGift),
  };
}

export async function updateControlSettings(payload, adminId = null) {
  validatePayload(payload);

  return db.transaction(async (trx) => {
    await ensureDefaultControlSettings(trx);
    const todayDateKey = normaliseDate(new Date());

    const globalRulesRow = await trx(TRADING_FLOW_TABLE).where({ is_active: true }).orderBy('id', 'asc').first();
    const existingBirthdayRows = await trx(BIRTHDAY_GIFTS_TABLE)
      .where({ is_active: true })
      .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);

    await trx(TRADING_FLOW_TABLE)
      .where({ id: globalRulesRow.id })
      .update({
        investment_per_trade_percent: payload.globalRules.investmentPerTradePercent.toFixed(2),
        daily_percent_per_trade: payload.globalRules.dailyPercentPerTrade.toFixed(2),
        signal_validity_minutes: payload.globalRules.signalValidityMinutes,
        telegram_channel_url: payload.globalRules.telegramChannelUrl,
        updated_by: adminId,
        updated_at: new Date(),
      });

    for (const slot of payload.tradeSlots) {
      if (!slot.id) {
        throw createValidationError({ tradeSlots: 'Each trade slot update must include an id' });
      }
      const existingSlot = await trx(TRADE_SLOTS_TABLE).where({ id: slot.id }).first();
      if (!existingSlot) {
        throw createValidationError({ [`tradeSlots_${slot.id}`]: 'Trade slot not found' });
      }

      const previousSlotTime = String(existingSlot.slot_time || '').slice(0, 8);
      const nextSlotTime = String(slot.slotTime || '').slice(0, 8);
      const updated = await trx(TRADE_SLOTS_TABLE)
        .where({ id: slot.id })
        .update({
          slot_name: String(slot.slotName).trim(),
          slot_time: slot.slotTime,
          is_active: slot.isEnabled,
          sort_order: slot.sortOrder,
          updated_at: new Date(),
        });
      if (!updated) {
        throw createValidationError({ [`tradeSlots_${slot.id}`]: 'Trade slot not found' });
      }

      if (previousSlotTime !== nextSlotTime) {
        await trx(TRADE_SLOT_BATCHES_TABLE)
          .where({ slot_id: Number(slot.id), slot_date: todayDateKey })
          .update({
            slot_time: slot.slotTime,
            updated_at: new Date(),
          });
      }
    }

    if (payload.generatedTokens && typeof payload.generatedTokens === 'object') {
      for (const slot of payload.tradeSlots) {
        const nextToken = payload.generatedTokens[String(slot.id)] ?? payload.generatedTokens[slot.id];
        if (!nextToken || !String(nextToken).trim()) continue;
        await persistTradeSlotBatchToken(slot.id, String(nextToken).trim(), new Date(), trx);
      }
    }

    for (const tier of payload.packageTiers) {
      if (!tier.id) {
        throw createValidationError({ packageTiers: 'Each package tier update must include an id' });
      }
      const updated = await trx(PACKAGE_TIERS_TABLE)
        .where({ id: tier.id })
        .update({
          package_name: String(tier.packageName).trim(),
          min_amount: Number(tier.minAmount).toFixed(2),
          max_amount: tier.maxAmount === null ? null : Number(tier.maxAmount).toFixed(2),
          signals_per_day: tier.signalsPerDay,
          required_level_id: tier.requiredLevelId,
          is_active: tier.isEnabled,
          sort_order: tier.sortOrder,
          updated_at: new Date(),
        });
      if (!updated) {
        throw createValidationError({ [`packageTiers_${tier.id}`]: 'Package tier not found' });
      }
    }

    const seenBirthdayIds = [];
    for (let index = 0; index < payload.birthdayGift.length; index += 1) {
      const gift = payload.birthdayGift[index];
      const existingRow = existingBirthdayRows[index];
      const updateValues = {
        is_enabled: gift.isEnabled,
        minimum_eligible_level: String(gift.minimumEligibleLevel).trim(),
        gift_amount: Number(gift.giftAmount).toFixed(2),
        sort_order: gift.sortOrder ?? index + 1,
        is_active: true,
        updated_by: adminId,
        updated_at: new Date(),
      };

      if (existingRow) {
        await trx(BIRTHDAY_GIFTS_TABLE).where({ id: existingRow.id }).update(updateValues);
        seenBirthdayIds.push(existingRow.id);
      } else {
        const inserted = await trx(BIRTHDAY_GIFTS_TABLE).insert({
          ...updateValues,
          created_at: new Date(),
        });
        seenBirthdayIds.push(Array.isArray(inserted) ? inserted[0] : inserted);
      }
    }

    const extraBirthdayIds = existingBirthdayRows.map((row) => row.id).filter((id) => !seenBirthdayIds.includes(id));
    if (extraBirthdayIds.length > 0) {
      await trx(BIRTHDAY_GIFTS_TABLE)
        .whereIn('id', extraBirthdayIds)
        .update({
          is_active: false,
          updated_by: adminId,
          updated_at: new Date(),
        });
    }

    return getControlSettings(trx);
  });
}

function generateBatchToken() {
  let token = '';
  for (let i = 0; i < 10; i += 1) {
    token += String(i === 0 ? randomInt(1, 10) : randomInt(0, 10));
  }
  return token;
}

async function generateUniqueBatchToken(trx) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const candidate = generateBatchToken();
      const existing = await trx(TRADE_SLOT_BATCHES_TABLE).where({ batch_token: candidate }).first();
      if (!existing) return candidate;
    } catch (error) {
      if (attempt === 9) throw error;
    }
  }
  const err = new Error('Unable to generate unique batch token');
  err.status = 500;
  throw err;
}

async function ensureBatchTokenAvailable(candidate, trx, excludeBatchId = null) {
  const existing = await trx(TRADE_SLOT_BATCHES_TABLE).where({ batch_token: candidate }).first();
  if (!existing) return true;
  if (excludeBatchId !== null && Number(existing.id) === Number(excludeBatchId)) return true;
  return false;
}

export async function previewTradeSlotBatchToken(slotId, slotDate = null, trx = db) {
  await ensureDefaultControlSettings(trx);

  const normalizedSlotDate = normaliseDate(slotDate ?? new Date());
  const slot = await trx(TRADE_SLOTS_TABLE).where({ id: Number(slotId) }).first();
  if (!slot) {
    const error = new Error('Trade slot not found');
    error.status = 404;
    throw error;
  }

  const nextToken = await generateUniqueBatchToken(trx);
  return {
    id: `preview-${slot.id}-${normalizedSlotDate}`,
    slotId: slot.id,
    slotDate: normalizedSlotDate,
    slotTime: String(slot.slot_time).slice(0, 8),
    batchToken: nextToken,
    status: 'preview',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function persistTradeSlotBatchToken(slotId, batchToken, slotDate = null, trx = db) {
  await ensureDefaultControlSettings(trx);

  const normalizedSlotDate = normaliseDate(slotDate ?? new Date());
  const normalizedToken = String(batchToken ?? '').trim();
  if (!/^\d{10}$/.test(normalizedToken)) {
    const error = new Error('Batch token must be a 10-digit string');
    error.status = 400;
    throw error;
  }

  const slot = await trx(TRADE_SLOTS_TABLE).where({ id: Number(slotId) }).first();
  if (!slot) {
    const error = new Error('Trade slot not found');
    error.status = 404;
    throw error;
  }

  const existing = await trx(TRADE_SLOT_BATCHES_TABLE)
    .where({ slot_id: Number(slotId), slot_date: normalizedSlotDate })
    .first();

  const available = await ensureBatchTokenAvailable(normalizedToken, trx, existing?.id ?? null);
  if (!available) {
    const error = new Error('Generated token already exists');
    error.status = 409;
    throw error;
  }

  if (!existing) {
    const inserted = await trx(TRADE_SLOT_BATCHES_TABLE).insert({
      slot_id: Number(slotId),
      slot_date: normalizedSlotDate,
      slot_time: slot.slot_time,
      batch_token: normalizedToken,
      token_history_json: JSON.stringify([buildTokenHistoryEntry(normalizedToken, 'generated')]),
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    const created = await trx(TRADE_SLOT_BATCHES_TABLE).where({ id }).first();
    return mapTradeSlotBatch(created);
  }

  const existingHistory = parseTokenHistory(existing.token_history_json);
  const nextHistory = normalizedToken === existing.batch_token
    ? existingHistory
    : [
        ...existingHistory,
        buildTokenHistoryEntry(normalizedToken, 'regenerated', new Date(), existing.batch_token),
      ];

  await trx(TRADE_SLOT_BATCHES_TABLE)
    .where({ id: existing.id })
    .update({
      slot_time: slot.slot_time,
      batch_token: normalizedToken,
      token_history_json: JSON.stringify(nextHistory),
      status: 'active',
      updated_at: new Date(),
    });

  const updated = await trx(TRADE_SLOT_BATCHES_TABLE).where({ id: existing.id }).first();
  return mapTradeSlotBatch(updated);
}

export async function createOrGetTradeSlotBatch(slotId, slotDate, trx = db) {
  await ensureDefaultControlSettings(trx);

  const normalizedSlotDate = normaliseDate(slotDate);
  const slot = await trx(TRADE_SLOTS_TABLE).where({ id: Number(slotId) }).first();
  if (!slot) {
    const error = new Error('Trade slot not found');
    error.status = 404;
    throw error;
  }

  const existing = await trx(TRADE_SLOT_BATCHES_TABLE)
    .where({ slot_id: Number(slotId), slot_date: normalizedSlotDate })
    .first();
  if (existing) return mapTradeSlotBatch(existing);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const batchToken = await generateUniqueBatchToken(trx);
    try {
      const inserted = await trx(TRADE_SLOT_BATCHES_TABLE).insert({
        slot_id: Number(slotId),
        slot_date: normalizedSlotDate,
        slot_time: slot.slot_time,
        batch_token: batchToken,
        token_history_json: JSON.stringify([buildTokenHistoryEntry(batchToken, 'generated')]),
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      });
      const id = Array.isArray(inserted) ? inserted[0] : inserted;
      const created = await trx(TRADE_SLOT_BATCHES_TABLE).where({ id }).first();
      return mapTradeSlotBatch(created);
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const slotDateExisting = await trx(TRADE_SLOT_BATCHES_TABLE)
        .where({ slot_id: Number(slotId), slot_date: normalizedSlotDate })
        .first();
      if (slotDateExisting) return mapTradeSlotBatch(slotDateExisting);
    }
  }

  const error = new Error('Unable to create trade slot batch');
  error.status = 500;
  throw error;
}

export async function generateTradeSlotBatchForDate(slotId, slotDate = null, trx = db) {
  return createOrGetTradeSlotBatch(slotId, slotDate ?? new Date(), trx);
}

export async function regenerateTradeSlotBatchToken(slotId, slotDate = null, trx = db) {
  await ensureDefaultControlSettings(trx);

  const normalizedSlotDate = normaliseDate(slotDate ?? new Date());
  const slot = await trx(TRADE_SLOTS_TABLE).where({ id: Number(slotId) }).first();
  if (!slot) {
    const error = new Error('Trade slot not found');
    error.status = 404;
    throw error;
  }

  const existing = await trx(TRADE_SLOT_BATCHES_TABLE)
    .where({ slot_id: Number(slotId), slot_date: normalizedSlotDate })
    .first();

  const nextToken = await generateUniqueBatchToken(trx);

  if (!existing) {
    const inserted = await trx(TRADE_SLOT_BATCHES_TABLE).insert({
      slot_id: Number(slotId),
      slot_date: normalizedSlotDate,
      slot_time: slot.slot_time,
      batch_token: nextToken,
      token_history_json: JSON.stringify([buildTokenHistoryEntry(nextToken, 'generated')]),
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    const created = await trx(TRADE_SLOT_BATCHES_TABLE).where({ id }).first();
    return mapTradeSlotBatch(created);
  }

  const existingHistory = parseTokenHistory(existing.token_history_json);
  const nextHistory = [
    ...existingHistory,
    buildTokenHistoryEntry(nextToken, 'regenerated', new Date(), existing.batch_token),
  ];

  await trx(TRADE_SLOT_BATCHES_TABLE)
    .where({ id: existing.id })
    .update({
      slot_time: slot.slot_time,
      batch_token: nextToken,
      token_history_json: JSON.stringify(nextHistory),
      status: 'active',
      updated_at: new Date(),
    });

  const updated = await trx(TRADE_SLOT_BATCHES_TABLE).where({ id: existing.id }).first();
  return mapTradeSlotBatch(updated);
}

export async function assignSignalToTradeSlotBatch({ signalId, slotId, slotDate, userSignalLogId = null }, trx = db) {
  const batch = await createOrGetTradeSlotBatch(slotId, slotDate, trx);
  const now = new Date();

  if (signalId !== null && signalId !== undefined && await trx.schema.hasTable('signals')) {
    await trx('signals').where({ id: signalId }).update({
      trade_slot_batch_id: batch.id,
      updated_at: now,
    });
  }

  if (userSignalLogId !== null && userSignalLogId !== undefined && await trx.schema.hasTable('user_signal_logs')) {
    await trx('user_signal_logs').where({ id: userSignalLogId }).update({
      trade_slot_batch_id: batch.id,
      batch_token: batch.batchToken,
      slot_time_snapshot: batch.slotTime,
      updated_at: now,
    });
  }

  return batch;
}

export async function getDayWiseSignalHistory(trx = db) {
  const rows = await trx(`${TRADE_SLOT_BATCHES_TABLE} as batches`)
    .leftJoin(`${TRADE_SLOTS_TABLE} as slots`, 'slots.id', 'batches.slot_id')
    .select(
      'batches.slot_date',
      'batches.slot_id',
      'batches.slot_time',
      'batches.batch_token',
      'batches.created_at',
      'slots.slot_name'
    )
    .orderBy([{ column: 'batches.slot_date', order: 'desc' }, { column: 'batches.created_at', order: 'desc' }]);

  const grouped = new Map();

  for (const row of rows) {
    const dateKey = row.slot_date;
    const existing = grouped.get(dateKey) || {
      date: dateKey,
      '9': null,
      '12': null,
      '3': null,
      '6': null,
      createdAt: row.created_at,
      slotTokens: {},
    };

    const slotTime = String(row.slot_time).slice(0, 8);
    const slotIdKey = String(row.slot_id);
    existing.slotTokens[slotIdKey] = {
      slotId: row.slot_id,
      slotName: row.slot_name ?? null,
      slotTime,
      batchToken: row.batch_token,
    };

    if (slotTime === '09:00:00') existing['9'] = row.batch_token;
    if (slotTime === '12:00:00') existing['12'] = row.batch_token;
    if (slotTime === '15:00:00') existing['3'] = row.batch_token;
    if (slotTime === '18:00:00') existing['6'] = row.batch_token;
    if (!existing.createdAt || new Date(row.created_at).getTime() > new Date(existing.createdAt).getTime()) {
      existing.createdAt = row.created_at;
    }

    grouped.set(dateKey, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export async function getSignalHistoryByBatchToken(batchToken, trx = db) {
  const token = String(batchToken ?? '').trim();
  if (!/^\d{10}$/.test(token)) {
    throw createValidationError({ batchToken: 'Batch token must be a 10-digit string' });
  }

  const batch = await trx(TRADE_SLOT_BATCHES_TABLE)
    .leftJoin(`${TRADE_SLOTS_TABLE} as slots`, 'slots.id', `${TRADE_SLOT_BATCHES_TABLE}.slot_id`)
    .select(`${TRADE_SLOT_BATCHES_TABLE}.*`, 'slots.slot_name')
    .where(`${TRADE_SLOT_BATCHES_TABLE}.batch_token`, token)
    .first();

  if (!batch) {
    const error = new Error('Batch token not found');
    error.status = 404;
    throw error;
  }

  const response = {
    batch: {
      id: batch.id,
      slotId: batch.slot_id,
      slotName: batch.slot_name,
      slotDate: batch.slot_date,
      slotTime: String(batch.slot_time).slice(0, 8),
      batchToken: batch.batch_token,
      tokenHistory: parseTokenHistory(batch.token_history_json),
      tokenGenerationCount: parseTokenHistory(batch.token_history_json).length,
      status: batch.status,
      slotLabel: SLOT_HISTORY_LABELS[String(batch.slot_time).slice(0, 8)] ?? null,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
    },
    signals: [],
    userSignalLogs: [],
  };

  if (await trx.schema.hasTable('signals')) {
    response.signals = await trx('signals').where({ trade_slot_batch_id: batch.id }).orderBy('id', 'desc');
  }

  if (await trx.schema.hasTable('user_signal_logs')) {
    response.userSignalLogs = await trx('user_signal_logs')
      .where((builder) => builder.where({ trade_slot_batch_id: batch.id }).orWhere({ batch_token: token }))
      .orderBy('id', 'desc');
  }

  return response;
}
