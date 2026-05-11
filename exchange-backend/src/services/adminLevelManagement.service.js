import { mysqlPool } from '../config/db.js';
import { db } from '../db.js';
import { up as ensureLevelManagementMigration } from '../../db/migrations/026_admin_level_management.js';
import {
  COUNT_LEVEL_SETTINGS,
  DEFAULT_LEVEL_SETTINGS,
  getDefaultConfigBindings,
  getDefaultLevelSettingsBindings,
  INSERT_DEFAULT_CONFIG,
  INSERT_DEFAULT_LEVEL_SETTINGS,
  INSERT_ONE_LEVEL_SETTING,
  SELECT_ACTIVE_CONFIG,
  SELECT_LEVEL_SETTINGS,
  UPDATE_CONFIG,
  UPDATE_LEVEL_SETTING,
} from '../queries/adminLevelManagement.query.js';
import { validateLevelManagementPayload } from '../validations/adminLevelManagement.validation.js';

let schemaReadyPromise = null;

function formatDecimal(value, fractionDigits = 2) {
  return Number(value ?? 0).toFixed(fractionDigits);
}

async function ensureLevelManagementSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureLevelManagementMigration(db).catch((error) => {
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
    directSponsorCommissionPercent: Number(row.direct_sponsor_commission_percent),
    joinedCommissionPercent: Number(row.joined_commission_percent),
    isCommissionActive: Boolean(row.is_commission_active),
    isActive: Boolean(row.is_active),
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureDefaultLevelRows(connection) {
  const [countRows] = await connection.execute(COUNT_LEVEL_SETTINGS);
  const total = Number(countRows?.[0]?.total ?? 0);

  if (total === 0) {
    await connection.execute(INSERT_DEFAULT_LEVEL_SETTINGS, getDefaultLevelSettingsBindings());
    return;
  }

  if (total < DEFAULT_LEVEL_SETTINGS.length) {
    const [rows] = await connection.execute(SELECT_LEVEL_SETTINGS);
    const existingCodes = new Set(rows.map((row) => row.level_code));
    const missing = DEFAULT_LEVEL_SETTINGS.filter(([levelCode]) => !existingCodes.has(levelCode));
    for (const row of missing) {
      await connection.execute(INSERT_ONE_LEVEL_SETTING, row);
    }
  }
}

async function ensureDefaultConfigRow(connection) {
  const [rows] = await connection.execute(SELECT_ACTIVE_CONFIG);
  if (rows.length === 0) {
    await connection.execute(INSERT_DEFAULT_CONFIG, getDefaultConfigBindings(null));
  }
}

export async function ensureDefaultLevelManagementSettings(connection) {
  await ensureLevelManagementSchema();
  await ensureDefaultLevelRows(connection);
  await ensureDefaultConfigRow(connection);
}

export async function getLevelManagementSettings() {
  const connection = await mysqlPool.getConnection();
  try {
    await ensureDefaultLevelManagementSettings(connection);

    const [levelRows] = await connection.execute(SELECT_LEVEL_SETTINGS);
    const [configRows] = await connection.execute(SELECT_ACTIVE_CONFIG);

    return {
      levels: levelRows.map(mapLevelRow),
      config: mapConfigRow(configRows[0]),
    };
  } finally {
    connection.release();
  }
}

export async function updateLevelManagementSettings(payload, adminId = null) {
  validateLevelManagementPayload(payload);

  const connection = await mysqlPool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaultLevelManagementSettings(connection);

    for (const level of payload.levels) {
      if (!level.id) {
        const error = new Error('Each level row must include id');
        error.status = 400;
        error.code = 'VALIDATION_FAILED';
        error.errors = { levels: 'Each level row must include id' };
        throw error;
      }

      const [result] = await connection.execute(UPDATE_LEVEL_SETTING, [
        String(level.qualificationText).trim(),
        formatDecimal(level.bonusPercent),
        formatDecimal(level.promotionRewardUsdt),
        level.isEnabled ? 1 : 0,
        level.sortOrder,
        level.id,
        String(level.levelCode).trim(),
      ]);

      if (result.affectedRows === 0) {
        const error = new Error(`Level ${level.levelCode} was not found`);
        error.status = 400;
        error.code = 'VALIDATION_FAILED';
        error.errors = { [`level_${level.id}`]: `Level ${level.levelCode} was not found` };
        throw error;
      }
    }

    const [configRows] = await connection.execute(SELECT_ACTIVE_CONFIG);
    const activeConfig = configRows[0];

    await connection.execute(UPDATE_CONFIG, [
      String(payload.config.directReferralNote).trim(),
      String(payload.config.newUserRewardNote).trim(),
      String(payload.config.levelAchievementNote).trim(),
      String(payload.config.salaryRewardNote).trim(),
      String(payload.config.oneTimeRewardNote).trim(),
      String(payload.config.minimumDepositEligibilityNote).trim(),
      formatDecimal(payload.config.minimumEligibleDeposit),
      formatDecimal(payload.config.directSponsorCommissionPercent),
      formatDecimal(payload.config.joinedCommissionPercent),
      payload.config.isCommissionActive ? 1 : 0,
      adminId,
      activeConfig.id,
    ]);

    const [levelRows] = await connection.execute(SELECT_LEVEL_SETTINGS);
    const [freshConfigRows] = await connection.execute(SELECT_ACTIVE_CONFIG);

    await connection.commit();

    return {
      levels: levelRows.map(mapLevelRow),
      config: mapConfigRow(freshConfigRows[0]),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
