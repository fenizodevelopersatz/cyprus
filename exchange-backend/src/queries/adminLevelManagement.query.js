export const DEFAULT_LEVEL_SETTINGS = [
  ['Lv1', '5 direct reports', '0.50', '100.00', 1, 1],
  ['Lv2', '2 direct LV1 / 25 team members', '1.00', '300.00', 1, 2],
  ['Lv3', '3 direct LV1 / 125 team members', '2.00', '800.00', 1, 3],
  ['Lv4', '4 direct LV1 / 500 team members', '2.50', '2000.00', 1, 4],
  ['Lv5', '5 direct LV1 / 1000 team members', '3.00', '5000.00', 1, 5],
  ['Lv6', '6 direct LV1 / 2000 team members', '3.50', '12000.00', 1, 6],
  ['Lv7', '7 direct LV1 / 5000 team members', '4.00', '25000.00', 1, 7],
  ['Lv8', '3 direct LV7 / 20000 team members', '4.50', '100000.00', 1, 8],
  ['Lv9', '4 direct LV7 / 50000 team members', '5.00', '200000.00', 1, 9],
  ['Lv10', '3 direct LV8 / 100000 team members', '5.50', '500000.00', 1, 10],
  ['Lv11', '4 direct LV8 / 200000 team members', '6.00', '1000000.00', 1, 11],
  ['Lv12', '5 direct LV9 / 300000 team members', '6.50', '2000000.00', 1, 12],
];

export const DEFAULT_LEVEL_MANAGEMENT_CONFIG = {
  directReferralNote: 'Sponsor gets commission %',
  newUserRewardNote: 'New user gets joining reward %',
  levelAchievementNote: 'When user reaches level:',
  salaryRewardNote: 'Gets Minimum Salary (every 10 days)',
  oneTimeRewardNote: 'Gets One-time reward',
  minimumDepositEligibilityNote: 'Every Downline person should have Min $300, then only it’s calculated',
  minimumEligibleDeposit: '300.00',
  directSponsorCommissionPercent: '5.00',
  joinedCommissionPercent: '2.00',
  isCommissionActive: 1,
  isActive: 1,
};

export const COUNT_LEVEL_SETTINGS = `
  SELECT COUNT(*) AS total
  FROM admin_level_settings
`;

export const INSERT_DEFAULT_LEVEL_SETTINGS = `
  INSERT INTO admin_level_settings (
    level_code,
    qualification_text,
    bonus_percent,
    promotion_reward_usdt,
    is_enabled,
    sort_order
  ) VALUES
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?)
`;

export const INSERT_ONE_LEVEL_SETTING = `
  INSERT INTO admin_level_settings (
    level_code,
    qualification_text,
    bonus_percent,
    promotion_reward_usdt,
    is_enabled,
    sort_order
  ) VALUES (?, ?, ?, ?, ?, ?)
`;

export const SELECT_LEVEL_SETTINGS = `
  SELECT
    id,
    level_code,
    qualification_text,
    bonus_percent,
    promotion_reward_usdt,
    is_enabled,
    sort_order,
    created_at,
    updated_at
  FROM admin_level_settings
  ORDER BY sort_order ASC, id ASC
`;

export const UPDATE_LEVEL_SETTING = `
  UPDATE admin_level_settings
  SET
    qualification_text = ?,
    bonus_percent = ?,
    promotion_reward_usdt = ?,
    is_enabled = ?,
    sort_order = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND level_code = ?
`;

export const SELECT_ACTIVE_CONFIG = `
  SELECT
    id,
    direct_referral_note,
    new_user_reward_note,
    level_achievement_note,
    salary_reward_note,
    one_time_reward_note,
    minimum_deposit_eligibility_note,
    minimum_eligible_deposit,
    direct_sponsor_commission_percent,
    joined_commission_percent,
    is_commission_active,
    is_active,
    updated_by,
    created_at,
    updated_at
  FROM admin_level_management_config
  WHERE is_active = 1
  ORDER BY id ASC
  LIMIT 1
`;

export const INSERT_DEFAULT_CONFIG = `
  INSERT INTO admin_level_management_config (
    direct_referral_note,
    new_user_reward_note,
    level_achievement_note,
    salary_reward_note,
    one_time_reward_note,
    minimum_deposit_eligibility_note,
    minimum_eligible_deposit,
    direct_sponsor_commission_percent,
    joined_commission_percent,
    is_commission_active,
    is_active,
    updated_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const UPDATE_CONFIG = `
  UPDATE admin_level_management_config
  SET
    direct_referral_note = ?,
    new_user_reward_note = ?,
    level_achievement_note = ?,
    salary_reward_note = ?,
    one_time_reward_note = ?,
    minimum_deposit_eligibility_note = ?,
    minimum_eligible_deposit = ?,
    direct_sponsor_commission_percent = ?,
    joined_commission_percent = ?,
    is_commission_active = ?,
    updated_by = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`;

export function getDefaultLevelSettingsBindings() {
  return DEFAULT_LEVEL_SETTINGS.flat();
}

export function getDefaultConfigBindings(updatedBy = null) {
  return [
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.directReferralNote,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.newUserRewardNote,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.levelAchievementNote,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.salaryRewardNote,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.oneTimeRewardNote,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.minimumDepositEligibilityNote,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.minimumEligibleDeposit,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.directSponsorCommissionPercent,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.joinedCommissionPercent,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.isCommissionActive,
    DEFAULT_LEVEL_MANAGEMENT_CONFIG.isActive,
    updatedBy,
  ];
}
