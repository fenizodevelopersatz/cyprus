import api from "../../../app/axios";
import { STAKING_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = {
  status?: boolean;
  code?: number;
  message?: string;
  data: T;
};

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data as T;
  }
  return payload as T;
};

export type StakingSummary = {
  totalValueUsd: number;
  averageApr: number;
  activeLockups: number;
  nextRewardCycle?: {
    nextAt?: string;
    secondsUntil?: number;
    intervalHours?: number;
  };
};

export type StakingPoolStats = {
  activePositions?: number;
  totalLocked?: string;
  totalLockedUsd?: number;
};

export type StakingPool = {
  id: number;
  label: string;
  asset: string;
  aprPercent: number;
  lockDays: number;
  minAmount?: string;
  maxAmount?: string | null;
  isFeatured?: boolean;
  status?: string;
  description?: string;
  stats?: StakingPoolStats;
};

export type StakingPosition = {
  id: number;
  packageId: number;
  asset: string;
  amount: string;
  aprPercent: number;
  lockDays: number;
  autoCompound: boolean;
  status: string;
  stakedAt: string;
  unlockAt: string | null;
  matured: boolean;
  canUnstake: boolean;
  rewardsAccrued: string;
  rewardsPaid: string;
  estimatedRewards: string;
  dailyReward: string;
  progressPercent?: number;
};

export type StakingActivityItem = {
  id: number | string;
  asset: string;
  amount: string;
  status: string;
  action: string;
  rewards?: string | null;
  timestamp: string;
};

export type StakingOverviewResponse = {
  summary: StakingSummary;
  pools: StakingPool[];
  positions: StakingPosition[];
  activity: StakingActivityItem[];
};

export type StakingEarningsSummary = {
  totalLockedUsd: number;
  realizedRewardsUsd: number;
  pendingRewardsUsd: number;
  dailyRewardsUsd: number;
  projected30dUsd: number;
  activePositions: number;
  completedPositions: number;
  totalPositions: number;
  averageApr: number;
  nextRewardCycle?: {
    nextAt?: string;
    secondsUntil?: number;
    intervalHours?: number;
  };
};

export type StakingEarningsBreakdownEntry = {
  asset: string;
  principal: string;
  principalUsd: number;
  averageApr: number;
  activePositions: number;
  completedPositions: number;
  pendingRewards: string;
  pendingRewardsUsd: number;
  realizedRewards: string;
  realizedRewardsUsd: number;
  dailyRewardsUsd: number;
};

export type StakingRealizedHistoryPoint = {
  date: string;
  realizedRewardsUsd: number;
};

export type StakingRealizedHistory = {
  rangeDays: number;
  points: StakingRealizedHistoryPoint[];
};

export type StakingRecentPayout = {
  positionId: number;
  asset: string;
  rewardsPaid: string;
  rewardsPaidUsd: number;
  aprPercent: number;
  stakedAt: string;
  unstakedAt?: string | null;
  user?: {
    id: number | string;
    email?: string;
    fullName?: string | null;
  };
  package?: {
    id: number | string;
    label?: string;
    asset?: string;
  };
};

export type StakingEarningsReport = {
  summary: StakingEarningsSummary;
  breakdown: StakingEarningsBreakdownEntry[];
  realizedHistory: StakingRealizedHistory;
  recentPayouts: StakingRecentPayout[];
  priceMap: Record<string, number>;
};

export type StakePositionRequest = {
  packageId: number;
  amount: string;
  autoCompound?: boolean;
};

export async function fetchStakingOverview(): Promise<StakingOverviewResponse> {
  const response = await api.get<StakingOverviewResponse | ApiEnvelope<StakingOverviewResponse>>(
    STAKING_ENDPOINTS.overview
  );
  return unwrap(response.data);
}

export async function fetchStakingPools(): Promise<StakingPool[]> {
  const response = await api.get<StakingPool[] | ApiEnvelope<StakingPool[]>>(STAKING_ENDPOINTS.pools);
  return unwrap(response.data);
}

export async function fetchStakingPositions(params?: { status?: string }): Promise<StakingPosition[]> {
  const response = await api.get<StakingPosition[] | ApiEnvelope<StakingPosition[]>>(
    STAKING_ENDPOINTS.positions(params)
  );
  return unwrap(response.data);
}

export async function createStakingPosition(body: StakePositionRequest): Promise<StakingPosition> {
  const response = await api.post<StakingPosition | ApiEnvelope<StakingPosition>>(
    STAKING_ENDPOINTS.positions(),
    body
  );
  return unwrap(response.data);
}

export async function unstakePosition(positionId: number | string): Promise<StakingPosition> {
  const response = await api.post<StakingPosition | ApiEnvelope<StakingPosition>>(
    STAKING_ENDPOINTS.unstake(positionId)
  );
  return unwrap(response.data);
}

export async function fetchStakingEarnings(params?: { rangeDays?: number }): Promise<StakingEarningsReport> {
  const response = await api.get<StakingEarningsReport | ApiEnvelope<StakingEarningsReport>>(
    STAKING_ENDPOINTS.earnings(params)
  );
  return unwrap(response.data);
}
