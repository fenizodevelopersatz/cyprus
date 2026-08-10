import { db, withTx } from '../db.js';
import { up as ensureLevelManagementMigration } from '../../db/migrations/026_admin_level_management.js';
import { up as ensureBonusIntervalDaysMigration } from '../../db/migrations/040_add_bonus_interval_days_to_admin_level_management.js';
import { validateLevelManagementPayload } from '../validations/adminLevelManagement.validation.js';

let schemaReadyPromise = null;

function formatDecimal(value, fractionDigits = 2) {
  return Number(value ?? 0).toFixed(fractionDigits);
}

async function ensureLevelManagementSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureLevelManagementMigration(db)
      .then(() => ensureBonusIntervalDaysMigration(db))
      .catch((error) => {
      schemaReadyPromise = null;
      throw error;
      });
  }

  await schemaReadyPromise;
}

function mapLevelRow(row) {
  return {
    id: row.id,
    levelCode: row.level_code,
    qualificationText: row.qualification_text,
    bonusPercent: Number(row.bonus_percent),
    promotionRewardUsdt: Number(row.promotion_reward_usdt),
    isEnabled: Boolean(row.is_enabled),
    sortOrder: Number(row.sort_order),
  };
}

function mapConfigRow(row) {
  return {
    id: row.id,
    directReferralNote: row.direct_referral_note,
    newUserRewardNote: row.new_user_reward_note,
    levelAchievementNote: row.level_achievement_note,
    salaryRewardNote: row.salary_reward_note,
    oneTimeRewardNote: row.one_time_reward_note,
    minimumDepositEligibilityNote: row.minimum_deposit_eligibility_note,
    minimumEligibleDeposit: Number(row.minimum_eligible_deposit),
    bonusIntervalDays: Number(row.bonus_interval_days),
    directSponsorCommissionPercent: Number(row.direct_sponsor_commission_percent),
    joinedCommissionPercent: Number(row.joined_commission_percent),
    isCommissionActive: Boolean(row.is_commission_active),
    isActive: Boolean(row.is_active),
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEFAULT_LEVEL_SETTINGS_DATA = [
  { level_code: 'Lv1', qualification_text: 'Direct 5 active members', bonus_percent: 10, promotion_reward_usdt: 0, is_enabled: 1, sort_order: 1 },
  { level_code: 'Lv2', qualification_text: 'Direct 2 Lv1, Team 25', bonus_percent: 2, promotion_reward_usdt: 15, is_enabled: 1, sort_order: 2 },
  { level_code: 'Lv3', qualification_text: 'Direct 3 Lv1, Team 125', bonus_percent: 2, promotion_reward_usdt: 50, is_enabled: 1, sort_order: 3 },
  { level_code: 'Lv4', qualification_text: 'Direct 4 Lv1, Team 500', bonus_percent: 2, promotion_reward_usdt: 150, is_enabled: 1, sort_order: 4 },
  { level_code: 'Lv5', qualification_text: 'Direct 5 Lv1, Team 1,000', bonus_percent: 2, promotion_reward_usdt: 300, is_enabled: 1, sort_order: 5 },
  { level_code: 'Lv6', qualification_text: 'Direct 6 Lv1, Team 2,000', bonus_percent: 2, promotion_reward_usdt: 500, is_enabled: 1, sort_order: 6 },
  { level_code: 'Lv7', qualification_text: 'Direct 7 Lv1, Team 5,000', bonus_percent: 2, promotion_reward_usdt: 1500, is_enabled: 1, sort_order: 7 },
  { level_code: 'Lv8', qualification_text: 'Direct 3 Lv7, Team 20,000', bonus_percent: 1.5, promotion_reward_usdt: 5000, is_enabled: 1, sort_order: 8 },
  { level_code: 'Lv9', qualification_text: 'Direct 4 Lv7, Team 50,000', bonus_percent: 1, promotion_reward_usdt: 15000, is_enabled: 1, sort_order: 9 },
  { level_code: 'Lv10', qualification_text: 'Direct 3 Lv8, Team 100,000', bonus_percent: 1, promotion_reward_usdt: 30000, is_enabled: 1, sort_order: 10 },
  { level_code: 'Lv11', qualification_text: 'Direct 4 Lv8, Team 200,000', bonus_percent: 1, promotion_reward_usdt: 50000, is_enabled: 1, sort_order: 11 },
  { level_code: 'Lv12', qualification_text: 'Direct 5 Lv9, Team 300,000', bonus_percent: 1, promotion_reward_usdt: 100000, is_enabled: 1, sort_order: 12 },
];

const DEFAULT_CONFIG_DATA = {
  direct_referral_note: 'Direct referral bonus info',
  new_user_reward_note: 'New user reward info',
  level_achievement_note: 'Level achievement info',
  salary_reward_note: 'Salary reward info',
  one_time_reward_note: 'One time reward info',
  minimum_deposit_eligibility_note: 'Min deposit info',
  minimum_eligible_deposit: 300,
  bonus_interval_days: 1,
  direct_sponsor_commission_percent: 5,
  joined_commission_percent: 5,
  is_commission_active: 1,
  is_active: 1,
  created_at: new Date(),
  updated_at: new Date()
};

async function ensureDefaultLevelRows(trx) {
  const countRow = await trx('admin_level_settings').count({ total: '*' }).first();
  const total = Number(countRow?.total ?? 0);

  if (total === 0) {
    const now = new Date();
    const rowsToInsert = DEFAULT_LEVEL_SETTINGS_DATA.map(row => ({
      ...row,
      created_at: now,
      updated_at: now
    }));
    await trx('admin_level_settings').insert(rowsToInsert);
    return;
  }

  if (total < DEFAULT_LEVEL_SETTINGS_DATA.length) {
    const rows = await trx('admin_level_settings').select('level_code');
    const existingCodes = new Set(rows.map((row) => row.level_code));
    const missing = DEFAULT_LEVEL_SETTINGS_DATA.filter(row => !existingCodes.has(row.level_code));
    if (missing.length > 0) {
      const now = new Date();
      const rowsToInsert = missing.map(row => ({
        ...row,
        created_at: now,
        updated_at: now
      }));
      await trx('admin_level_settings').insert(rowsToInsert);
    }
  }
}

async function ensureDefaultConfigRow(trx) {
  const active = await trx('admin_level_management_config').where({ is_active: 1 }).first();
  if (!active) {
    await trx('admin_level_management_config').insert(DEFAULT_CONFIG_DATA);
  }
}

export async function ensureDefaultLevelManagementSettings(trx = db) {
  await ensureLevelManagementSchema();
  await ensureDefaultLevelRows(trx);
  await ensureDefaultConfigRow(trx);
}

export async function getLevelManagementSettings() {
  await ensureDefaultLevelManagementSettings(db);

  const levelRows = await db('admin_level_settings').select('*').orderBy('sort_order', 'asc');
  const configRows = await db('admin_level_management_config').select('*').where({ is_active: 1 }).limit(1);

  return {
    levels: levelRows.map(mapLevelRow),
    config: configRows[0] ? mapConfigRow(configRows[0]) : null,
  };
}

export async function updateLevelManagementSettings(payload, adminId = null) {
  validateLevelManagementPayload(payload);

  return withTx(async (trx) => {
    await ensureDefaultLevelManagementSettings(trx);

    for (const level of payload.levels) {
      if (!level.id) {
        const error = new Error('Each level row must include id');
        error.status = 400;
        error.code = 'VALIDATION_FAILED';
        error.errors = { levels: 'Each level row must include id' };
        throw error;
      }

      const updated = await trx('admin_level_settings')
        .where({ id: level.id, level_code: String(level.levelCode).trim() })
        .update({
          qualification_text: String(level.qualificationText).trim(),
          bonus_percent: formatDecimal(level.bonusPercent),
          promotion_reward_usdt: formatDecimal(level.promotionRewardUsdt),
          is_enabled: level.isEnabled ? 1 : 0,
          sort_order: level.sortOrder,
        });

      if (!updated) {
        const error = new Error(`Level ${level.levelCode} was not found`);
        error.status = 400;
        error.code = 'VALIDATION_FAILED';
        error.errors = { [`level_${level.id}`]: `Level ${level.levelCode} was not found` };
        throw error;
      }
    }

    const activeConfig = await trx('admin_level_management_config').where({ is_active: 1 }).first();

    await trx('admin_level_management_config')
      .where({ id: activeConfig.id })
      .update({
        direct_referral_note: String(payload.config.directReferralNote).trim(),
        new_user_reward_note: String(payload.config.newUserRewardNote).trim(),
        level_achievement_note: String(payload.config.levelAchievementNote).trim(),
        salary_reward_note: String(payload.config.salaryRewardNote).trim(),
        one_time_reward_note: String(payload.config.oneTimeRewardNote).trim(),
        minimum_deposit_eligibility_note: String(payload.config.minimumDepositEligibilityNote).trim(),
        minimum_eligible_deposit: formatDecimal(payload.config.minimumEligibleDeposit),
        bonus_interval_days: Math.max(1, Math.trunc(Number(payload.config.bonusIntervalDays ?? 10))),
        direct_sponsor_commission_percent: formatDecimal(payload.config.directSponsorCommissionPercent),
        joined_commission_percent: formatDecimal(payload.config.joinedCommissionPercent),
        is_commission_active: payload.config.isCommissionActive ? 1 : 0,
        updated_by: adminId,
      });

    const levelRows = await trx('admin_level_settings').select('*').orderBy('sort_order', 'asc');
    const freshConfigRows = await trx('admin_level_management_config').select('*').where({ is_active: 1 }).limit(1);

    return {
      levels: levelRows.map(mapLevelRow),
      config: mapConfigRow(freshConfigRows[0]),
    };
  });
}
