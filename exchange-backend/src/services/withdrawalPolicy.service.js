import { db } from '../db.js';
import { getSettings } from './settingsService.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Number(toNumber(value).toFixed(2));
}

export async function getWithdrawalPolicyContext(userId, amount = 0) {
  const [settings, user] = await Promise.all([
    getSettings(),
    db('users').where({ id: userId }).select('created_at', 'kyc_verified', 'status').first(),
  ]);

  const requestedAmount = toNumber(amount, 0);
  const adminFeePercent = toNumber(settings.withdrawalAdminFeePercent, 0);
  const lockPeriodDays = Math.max(0, toNumber(settings.withdrawalLockPeriodDays, 0));
  const earlyPenaltyPercent = toNumber(settings.earlyWithdrawalPenaltyPercent, 0);
  const minimumWithdrawalAmount = toNumber(settings.minimumWithdrawalAmount, 0);
  const maximumWithdrawalAmount = toNumber(settings.maximumWithdrawalAmount, 0);
  const createdAt = user?.created_at ? new Date(user.created_at) : null;
  const now = new Date();
  const elapsedDays = createdAt ? Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86400000)) : 0;
  const daysRemaining = Math.max(0, lockPeriodDays - elapsedDays);
  const lockActive = lockPeriodDays > 0 && daysRemaining > 0;
  const isActiveUser = String(user?.status || '').trim().toLowerCase() === 'active';
  const kycVerified = Boolean(user?.kyc_verified);
  const eligibilityWarnings = [
    !isActiveUser ? 'Your account is not active yet. Withdrawal is available only for active users.' : null,
    !kycVerified ? 'Complete KYC verification before submitting a withdrawal request.' : null,
  ].filter(Boolean);
  const canRequestWithdrawal = eligibilityWarnings.length === 0;

  const adminFeeAmount = requestedAmount * (adminFeePercent / 100);
  const earlyPenaltyAmount = lockActive ? requestedAmount * (earlyPenaltyPercent / 100) : 0;
  const netAmount = Math.max(0, requestedAmount - adminFeeAmount - earlyPenaltyAmount);

  return {
    policy: {
      withdrawalEnabled: settings.isWithdrawalEnabled !== false,
      withdrawalNote: String(settings.withdrawalNote || '').trim(),
      adminFeePercent,
      lockPeriodDays,
      earlyPenaltyPercent,
      rewardReductionEnabled: Boolean(settings.rewardReductionEnabled),
      rewardReductionType: String(settings.rewardReductionType || '').trim(),
      minimumWithdrawalAmount,
      maximumWithdrawalAmount,
    },
    user: {
      createdAt: createdAt ? createdAt.toISOString() : null,
      kycVerified,
      status: String(user?.status || '').trim().toLowerCase() || 'inactive',
      activeUser: isActiveUser,
      canRequestWithdrawal,
      eligibilityWarnings,
      accountAgeDays: elapsedDays,
      lockActive,
      daysRemaining,
    },
    preview: {
      requestedAmount: roundCurrency(requestedAmount),
      adminFeeAmount: roundCurrency(adminFeeAmount),
      earlyPenaltyAmount: roundCurrency(earlyPenaltyAmount),
      netAmount: roundCurrency(netAmount),
    },
  };
}
