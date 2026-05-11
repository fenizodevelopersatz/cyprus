import { db } from '../db.js';

const DEFAULT_SETTINGS = {
  minDeposit: '100.00000000',
  maxDeposit: '25000.00000000',
  investmentPerTradePct: '0.0000',
  perTradeProfitPct: '0.0000',
  dailyRoiPct: '0.0000',
  unlimitedLastPackage: true,
  autoPackageAssignment: true,
  packageUpgradeAllowed: true,
};

const DEFAULT_PACKAGES = [
  {
    name: 'Package 1',
    minAmount: '100.00000000',
    maxAmount: '299.00000000',
    unlimitedMax: false,
    perTradeCommissionPct: '0.6500',
    signalsPerDay: 1,
    requiredLevel: 0,
    status: 'ACTIVE',
    description: '0.65% commission for deposits from $100 to $299 with 1 signal per day.',
    sortOrder: 10,
  },
  {
    name: 'Package 2',
    minAmount: '300.00000000',
    maxAmount: '4999.00000000',
    unlimitedMax: false,
    perTradeCommissionPct: '1.3000',
    signalsPerDay: 2,
    requiredLevel: 0,
    status: 'ACTIVE',
    description: '1.3% commission for deposits from $300 to $4,999 with 2 signals per day.',
    sortOrder: 20,
  },
  {
    name: 'Package 3',
    minAmount: '5000.00000000',
    maxAmount: '24999.00000000',
    unlimitedMax: false,
    perTradeCommissionPct: '1.9500',
    signalsPerDay: 3,
    requiredLevel: 1,
    status: 'ACTIVE',
    description: '1.95% commission for deposits from $5,000 to $24,999 with 3 signals per day.',
    sortOrder: 30,
  },
  {
    name: 'Package 4',
    minAmount: '25000.00000000',
    maxAmount: null,
    unlimitedMax: true,
    perTradeCommissionPct: '2.6000',
    signalsPerDay: 4,
    requiredLevel: 2,
    status: 'ACTIVE',
    description: '2.6% commission for deposits at $25,000 and above with 4 signals per day.',
    sortOrder: 40,
  },
];

function badRequest(code) {
  const err = new Error(code);
  err.status = 400;
  return err;
}

function normalizeDecimal(value, field, { min = 0, allowNull = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (allowNull) return null;
    throw badRequest(`${field.toUpperCase()}_REQUIRED`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(`${field.toUpperCase()}_MUST_BE_NUMERIC`);
  if (parsed < min) throw badRequest(`${field.toUpperCase()}_OUT_OF_RANGE`);
  return parsed.toFixed(8);
}

function normalizePercent(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') throw badRequest(`${field.toUpperCase()}_REQUIRED`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(`${field.toUpperCase()}_MUST_BE_NUMERIC`);
  if (parsed < 0) throw badRequest(`${field.toUpperCase()}_OUT_OF_RANGE`);
  return parsed.toFixed(4);
}

function normalizeInteger(value, field, { min = 0 } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') throw badRequest(`${field.toUpperCase()}_REQUIRED`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw badRequest(`${field.toUpperCase()}_MUST_BE_INTEGER`);
  if (parsed < min) throw badRequest(`${field.toUpperCase()}_OUT_OF_RANGE`);
  return parsed;
}

function mapSettings(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    minDeposit: String(row.min_deposit),
    maxDeposit: String(row.max_deposit),
    investmentPerTradePct: String(row.investment_per_trade_pct),
    perTradeProfitPct: String(row.per_trade_profit_pct),
    dailyRoiPct: String(row.daily_roi_pct),
    unlimitedLastPackage: Boolean(row.unlimited_last_package),
    autoPackageAssignment: Boolean(row.auto_package_assignment),
    packageUpgradeAllowed: Boolean(row.package_upgrade_allowed),
  };
}

function mapPackage(row) {
  return {
    id: row.id,
    name: row.name,
    minAmount: String(row.min_amount),
    maxAmount: row.max_amount === null ? null : String(row.max_amount),
    unlimitedMax: Boolean(row.unlimited_max),
    perTradeCommissionPct: String(row.per_trade_commission_pct),
    signalsPerDay: Number(row.signals_per_day),
    requiredLevel: Number(row.required_level),
    status: row.status,
    description: row.description || '',
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureDefaults() {
  const settingsRow = await db('signal_package_settings').first();
  if (!settingsRow) {
    await db('signal_package_settings').insert({
      min_deposit: DEFAULT_SETTINGS.minDeposit,
      max_deposit: DEFAULT_SETTINGS.maxDeposit,
      investment_per_trade_pct: DEFAULT_SETTINGS.investmentPerTradePct,
      per_trade_profit_pct: DEFAULT_SETTINGS.perTradeProfitPct,
      daily_roi_pct: DEFAULT_SETTINGS.dailyRoiPct,
      unlimited_last_package: DEFAULT_SETTINGS.unlimitedLastPackage,
      auto_package_assignment: DEFAULT_SETTINGS.autoPackageAssignment,
      package_upgrade_allowed: DEFAULT_SETTINGS.packageUpgradeAllowed,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  const [{ count }] = await db('signal_packages').count({ count: '*' });
  if (Number(count || 0) > 0) return;

  await db('signal_packages').insert(
    DEFAULT_PACKAGES.map((pkg) => ({
      name: pkg.name,
      min_amount: pkg.minAmount,
      max_amount: pkg.maxAmount,
      unlimited_max: pkg.unlimitedMax,
      per_trade_commission_pct: pkg.perTradeCommissionPct,
      signals_per_day: pkg.signalsPerDay,
      required_level: pkg.requiredLevel,
      status: pkg.status,
      description: pkg.description,
      sort_order: pkg.sortOrder,
      created_at: new Date(),
      updated_at: new Date(),
    }))
  );
}

function validatePackageRanges(packages, settings) {
  const normalized = packages
    .map((pkg) => ({
      ...pkg,
      min: Number(pkg.minAmount),
      max: pkg.maxAmount === null ? null : Number(pkg.maxAmount),
    }))
    .sort((a, b) => (a.min - b.min) || (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name)));

  const unlimited = normalized.filter((pkg) => pkg.unlimitedMax);
  if (unlimited.length > 1) throw badRequest('ONLY_ONE_UNLIMITED_PACKAGE_ALLOWED');
  if (settings.unlimitedLastPackage && unlimited.length !== 1) {
    throw badRequest('UNLIMITED_LAST_PACKAGE_REQUIRED');
  }
  if (!settings.unlimitedLastPackage && unlimited.length > 0) {
    throw badRequest('UNLIMITED_LAST_PACKAGE_DISABLED');
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    if (current.max !== null && current.max < current.min) {
      throw badRequest('PACKAGE_MAX_MUST_BE_GREATER_THAN_MIN');
    }
    if (current.min < Number(settings.minDeposit)) {
      throw badRequest('PACKAGE_MIN_BELOW_GLOBAL_MIN_DEPOSIT');
    }
    if (!current.unlimitedMax && current.max !== null && current.max > Number(settings.maxDeposit)) {
      throw badRequest('PACKAGE_MAX_ABOVE_GLOBAL_MAX_DEPOSIT');
    }

    if (index > 0) {
      const previous = normalized[index - 1];
      if (previous.max === null || current.min <= previous.max) {
        throw badRequest('PACKAGE_RANGES_OVERLAP');
      }
    }
  }

  if (normalized.length === 0) return;

  const lastPackage = normalized[normalized.length - 1];
  if (settings.unlimitedLastPackage) {
    if (!lastPackage.unlimitedMax) throw badRequest('LAST_PACKAGE_MUST_BE_UNLIMITED');
    if (lastPackage.min !== Number(settings.maxDeposit)) {
      throw badRequest('UNLIMITED_PACKAGE_MUST_START_AT_MAX_DEPOSIT');
    }
  } else {
    if (lastPackage.max === null) throw badRequest('LAST_PACKAGE_MAX_REQUIRED');
    if (lastPackage.max !== Number(settings.maxDeposit)) {
      throw badRequest('LAST_PACKAGE_MUST_END_AT_MAX_DEPOSIT');
    }
  }
}

function sanitizeSettingsPatch(patch = {}) {
  const next = {};
  if (patch.minDeposit !== undefined) next.min_deposit = normalizeDecimal(patch.minDeposit, 'min_deposit');
  if (patch.maxDeposit !== undefined) next.max_deposit = normalizeDecimal(patch.maxDeposit, 'max_deposit');
  if (patch.investmentPerTradePct !== undefined) {
    next.investment_per_trade_pct = normalizePercent(patch.investmentPerTradePct, 'investment_per_trade_pct');
  }
  if (patch.perTradeProfitPct !== undefined) {
    next.per_trade_profit_pct = normalizePercent(patch.perTradeProfitPct, 'per_trade_profit_pct');
  }
  if (patch.dailyRoiPct !== undefined) {
    next.daily_roi_pct = normalizePercent(patch.dailyRoiPct, 'daily_roi_pct');
  }
  if (patch.unlimitedLastPackage !== undefined) next.unlimited_last_package = Boolean(patch.unlimitedLastPackage);
  if (patch.autoPackageAssignment !== undefined) next.auto_package_assignment = Boolean(patch.autoPackageAssignment);
  if (patch.packageUpgradeAllowed !== undefined) next.package_upgrade_allowed = Boolean(patch.packageUpgradeAllowed);
  return next;
}

function sanitizePackagePayload(payload, { partial = false } = {}) {
  const patch = {};
  if (!partial || payload.name !== undefined) {
    const name = String(payload.name || '').trim();
    if (!name) throw badRequest('PACKAGE_NAME_REQUIRED');
    patch.name = name;
  }
  if (!partial || payload.minAmount !== undefined) patch.min_amount = normalizeDecimal(payload.minAmount, 'min_amount');
  if (!partial || payload.maxAmount !== undefined || payload.unlimitedMax !== undefined) {
    patch.max_amount = normalizeDecimal(payload.maxAmount, 'max_amount', { allowNull: true });
  }
  if (!partial || payload.unlimitedMax !== undefined) patch.unlimited_max = Boolean(payload.unlimitedMax);
  if (!partial || payload.perTradeCommissionPct !== undefined) {
    patch.per_trade_commission_pct = normalizePercent(payload.perTradeCommissionPct, 'per_trade_commission_pct');
  }
  if (!partial || payload.signalsPerDay !== undefined) {
    patch.signals_per_day = normalizeInteger(payload.signalsPerDay, 'signals_per_day', { min: 1 });
  }
  if (!partial || payload.requiredLevel !== undefined) {
    patch.required_level = normalizeInteger(payload.requiredLevel, 'required_level', { min: 0 });
  }
  if (!partial || payload.status !== undefined) {
    const status = String(payload.status || '').trim().toUpperCase();
    if (!['ACTIVE', 'INACTIVE'].includes(status)) throw badRequest('INVALID_PACKAGE_STATUS');
    patch.status = status;
  }
  if (!partial || payload.description !== undefined) patch.description = String(payload.description || '').trim();
  if (!partial || payload.sortOrder !== undefined) {
    patch.sort_order = normalizeInteger(payload.sortOrder, 'sort_order', { min: 0 });
  }

  if (patch.unlimited_max && patch.max_amount !== null && patch.max_amount !== undefined) {
    patch.max_amount = null;
  }

  return patch;
}

async function getCurrentState(trx = db) {
  await ensureDefaults();
  const [settingsRow, packageRows] = await Promise.all([
    trx('signal_package_settings').orderBy('id', 'asc').first(),
    trx('signal_packages').orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'min_amount', order: 'asc' }, { column: 'id', order: 'asc' }]),
  ]);

  return {
    settings: mapSettings(settingsRow),
    packages: packageRows.map(mapPackage),
  };
}

function validateState(settings, packages) {
  const minDeposit = Number(settings.minDeposit);
  const maxDeposit = Number(settings.maxDeposit);
  if (!Number.isFinite(minDeposit) || !Number.isFinite(maxDeposit)) {
    throw badRequest('GLOBAL_DEPOSIT_LIMITS_INVALID');
  }
  if (maxDeposit < minDeposit) throw badRequest('MAX_DEPOSIT_MUST_BE_GREATER_THAN_MIN_DEPOSIT');
  validatePackageRanges(packages, settings);
}

export async function getSignalPackageModule() {
  return getCurrentState();
}

export async function updateSignalPackageSettings(patch = {}) {
  await ensureDefaults();
  return db.transaction(async (trx) => {
    const existingSettingsRow = await trx('signal_package_settings').orderBy('id', 'asc').first();
    const packageRows = await trx('signal_packages').orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'min_amount', order: 'asc' }, { column: 'id', order: 'asc' }]);

    const currentSettings = mapSettings(existingSettingsRow);
    const nextSettings = { ...currentSettings, ...mapSettings({ ...existingSettingsRow, ...sanitizeSettingsPatch(patch) }) };
    const packages = packageRows.map(mapPackage);
    validateState(nextSettings, packages);

    await trx('signal_package_settings')
      .where({ id: existingSettingsRow.id })
      .update({
        ...sanitizeSettingsPatch(patch),
        updated_at: new Date(),
      });

    return getCurrentState(trx);
  });
}

export async function createSignalPackage(payload) {
  await ensureDefaults();
  return db.transaction(async (trx) => {
    const state = await getCurrentState(trx);
    const sanitized = sanitizePackagePayload(payload);
    const draft = mapPackage({
      id: 0,
      ...sanitized,
      created_at: new Date(),
      updated_at: new Date(),
    });
    validateState(state.settings, [...state.packages, draft]);

    const inserted = await trx('signal_packages').insert({
      ...sanitized,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    const row = await trx('signal_packages').where({ id }).first();
    return mapPackage(row);
  });
}

export async function updateSignalPackage(id, patch = {}) {
  if (!id) throw badRequest('PACKAGE_ID_REQUIRED');
  await ensureDefaults();
  return db.transaction(async (trx) => {
    const existing = await trx('signal_packages').where({ id }).first();
    if (!existing) {
      const err = new Error('PACKAGE_NOT_FOUND');
      err.status = 404;
      throw err;
    }

    const state = await getCurrentState(trx);
    const sanitized = sanitizePackagePayload(patch, { partial: true });
    const mergedRow = { ...existing, ...sanitized };
    const draft = mapPackage(mergedRow);
    const packages = state.packages.map((item) => (Number(item.id) === Number(id) ? draft : item));
    validateState(state.settings, packages);

    await trx('signal_packages')
      .where({ id })
      .update({
        ...sanitized,
        updated_at: new Date(),
      });

    const row = await trx('signal_packages').where({ id }).first();
    return mapPackage(row);
  });
}
