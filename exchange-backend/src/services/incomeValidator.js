const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

export function canGiveDirectIncome(user) {
  return String(user?.direct_income_paid || 0) !== '1' && user?.direct_income_paid !== true;
}

export function canGiveJoinReward(user) {
  return String(user?.join_reward_paid || 0) !== '1' && user?.join_reward_paid !== true;
}

export function canGiveLevelIncome(user) {
  if (!user?.level_last_paid_at) return true;
  return Date.now() >= new Date(user.level_last_paid_at).getTime() + TEN_DAYS_MS;
}

export function canGiveRankBonus(userLevelHistoryRow) {
  return String(userLevelHistoryRow?.is_reward_given || 0) !== '1' && userLevelHistoryRow?.is_reward_given !== true;
}

export function canGiveSignalIncome() {
  return true;
}
