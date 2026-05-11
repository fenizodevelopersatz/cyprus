import api from "../../../app/axios";
import { API_BASE_URL, REFERRAL_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const ensureRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const ensureArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toAbsoluteAssetUrl = (value: string | null | undefined) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }
  return `${API_BASE_URL}${value.startsWith("/") ? value : `/${value}`}`;
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

export type ReferralMetric = {
  key: string;
  label: string;
  formattedValue: string;
  deltaLabel?: string;
  trend?: "up" | "down";
};

export type ReferralTier = {
  tier: string;
  requirementLabel: string;
  rewardLabel: string;
};

export type ReferralEntry = {
  id: string;
  email: string;
  status: "pending" | "verified" | "rewarded" | string;
  joinedAt: string;
  volumeFormatted: string;
};

export type ReferralPrimaryCode = {
  code: string;
  message: string;
  url: string;
  promoActive: boolean;
  updatedAt?: string;
};

export type ReferralDashboard = {
  metrics: ReferralMetric[];
  primaryCode: ReferralPrimaryCode;
  tiers: ReferralTier[];
  referrals: ReferralEntry[];
  mlm: {
    currentLevel: string | null;
    currentLevelRank: number;
    status: string;
    mainWalletBalance: string;
    minimumEligibleBalance: number;
    rewardApplicable: boolean;
    currentEligibleLevel?: string | null;
    currentEligibleLevelOrder?: number;
    nextBonusDueAt?: string | null;
    qualifiedAt?: string | null;
    isCurrentlyQualified?: boolean;
    positionStatus?: {
      activeDirectCount: number;
      activeTeamCount: number;
      directLv1Count: number;
      directLv7Count: number;
      directLv8Count: number;
      directLv9Count: number;
      lastCheckedAt?: string | null;
    };
    summary: {
      directTotalMembers: number;
      directEligibleMembers: number;
      directTotalBalance: string;
      directEligibleBalance: string;
      teamTotalMembers: number;
      teamEligibleMembers: number;
      teamTotalBalance: string;
      teamEligibleBalance: string;
      minimumEligibleTeamBalance?: string | null;
      lastCalculatedAt?: string | null;
    };
    levelSettings: Array<{
      levelCode: string;
      qualificationText: string;
      directRequirement: number;
      directLevelCode: string | null;
      teamRequirement: number;
      bonusPercent: number;
      promotionRewardUsdt: number;
      bonusBase: string;
      isEnabled: boolean;
      sortOrder: number;
    }>;
    tree: {
      rootUserId: number | null;
      totalNodes: number;
      maxDepth: number;
      nodes: Array<{
        id: number;
        pid?: number;
        name: string;
        email: string;
        profilePhoto?: string | null;
        levelCode: string | null;
        levelRank: number;
        status: string;
        walletBalance: string;
        directCount: number;
        depth: number;
        eligible: boolean;
        isRoot: boolean;
      }>;
    };
    promotionHistory: Array<{
      id: number;
      levelCode: string;
      levelRank: number;
      rewardAmount: string;
      bonusPercent: string;
      achievedAt: string;
      createdAt: string;
    }>;
    bonusPayoutHistory: Array<{
      id: number;
      levelCode: string;
      levelRank: number;
      bonusPercent: string;
      eligibleBalance: string;
      eligibleMembers: number;
      qualifiedDirectMembers: number;
      payoutAmount: string;
      periodStartedAt: string;
      periodEndedAt: string;
      status: string;
      createdAt: string;
    }>;
    recurringBonusHistory?: Array<{
      id: number;
      levelCode: string;
      percent: string;
      baseAmount: string;
      bonusAmount: string;
      cycleFrom: string;
      cycleTo: string;
      dueAt: string;
      paidAt?: string | null;
      status: string;
      skipReason?: string | null;
      createdAt: string;
    }>;
  };
};

export type ReferralIncomeHistoryItem = {
  id: number;
  txnId: string;
  date: string;
  incomeType: string;
  sourceUser: string | null;
  sourceUserEmail?: string | null;
  sourceUserName?: string | null;
  sourceUserLabel?: string | null;
  previousBalance: number;
  amount: number;
  newBalance: number;
  status: string;
  remark?: string | null;
};

const metricsConfig = [
  { key: "totalInvites", label: "Total invites", type: "number" as const },
  // { key: "verifiedTraders", label: "Verified traders", type: "number" as const },
  { key: "rewardsEarned", label: "Rewards earned", type: "currency" as const },
  { key: "pendingPayout", label: "Pending payout", type: "currency" as const },
];

const formatDeltaLabel = (entry: Record<string, unknown>, delta: number | undefined) => {
  if (entry.deltaLabel) return String(entry.deltaLabel);
  const period = typeof entry.period === "string" ? entry.period : undefined;
  if (delta === undefined) return undefined;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const magnitude = Math.abs(delta);
  const value =
    entry.type === "currency"
      ? currencyFormatter.format(magnitude)
      : numberFormatter.format(magnitude);
  return `${sign}${value}${period ? ` ${period}` : ""}`;
};

const mapMetric = (
  stats: Record<string, unknown>,
  config: { key: string; label: string; type: "number" | "currency" }
): ReferralMetric | null => {
  const raw = ensureRecord(stats[config.key]);
  const value =
    "value" in raw ? toNumber(raw.value) : toNumber(stats[config.key], config.type === "currency" ? 0 : 0);
  const formatter = config.type === "currency" ? currencyFormatter : numberFormatter;
  const delta = "delta" in raw ? toNumber(raw.delta) : undefined;
  const trend = delta === undefined ? undefined : delta >= 0 ? "up" : "down";
  const deltaLabel = formatDeltaLabel({ ...raw, type: config.type }, delta);
  return {
    key: config.key,
    label: config.label,
    formattedValue: formatter.format(value),
    deltaLabel,
    trend,
  };
};

const mapTier = (value: unknown): ReferralTier => {
  const raw = ensureRecord(value);
  const tier = String(raw.tier ?? raw.name ?? "");
  const requirement =
    typeof raw.requirementLabel === "string"
      ? raw.requirementLabel
      : raw.requirement !== undefined
      ? String(raw.requirement)
      : "";
  const reward =
    typeof raw.rewardLabel === "string"
      ? raw.rewardLabel
      : raw.reward !== undefined
      ? String(raw.reward)
      : "";
  return {
    tier,
    requirementLabel: requirement,
    rewardLabel: reward,
  };
};

const mapReferralEntry = (value: unknown): ReferralEntry => {
  const raw = ensureRecord(value);
  const id = String(raw.id ?? raw.email ?? randomId());
  const email = String(raw.email ?? raw.handle ?? "unknown");
  const status = String(raw.status ?? raw.state ?? "pending").toLowerCase();
  const joinedAt =
    typeof raw.joinedAt === "string"
      ? raw.joinedAt
      : typeof raw.joined === "string"
      ? raw.joined
      : new Date().toISOString();
  const volumeValue =
    raw.volumeFormatted !== undefined
      ? String(raw.volumeFormatted)
      : raw.volume !== undefined
      ? currencyFormatter.format(toNumber(raw.volume))
      : "--";
  return {
    id,
    email,
    status,
    joinedAt,
    volumeFormatted: volumeValue,
  };
};

const mapPrimaryCode = (value: unknown): ReferralPrimaryCode => {
  const raw = ensureRecord(value);
  return {
    code: String(raw.code ?? raw.referralCode ?? ""),
    message: String(
      raw.message ??
        raw.copy ??
        "Invite friends to earn trading rebates and welcome bonuses."
    ),
    url: String(raw.url ?? raw.link ?? ""),
    promoActive: raw.promoActive !== undefined ? Boolean(raw.promoActive) : true,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
};

const mapMlm = (value: unknown): ReferralDashboard["mlm"] => {
  const raw = ensureRecord(value);
  const summary = ensureRecord(raw.summary);
  const tree = ensureRecord(raw.tree);
  return {
    currentLevel: raw.currentLevel ? String(raw.currentLevel) : null,
    currentLevelRank: toNumber(raw.currentLevelRank),
    status: String(raw.status ?? "inactive"),
    mainWalletBalance: String(raw.mainWalletBalance ?? "0"),
    minimumEligibleBalance: toNumber(raw.minimumEligibleBalance, 300),
    rewardApplicable: Boolean(raw.rewardApplicable),
    currentEligibleLevel: raw.currentEligibleLevel ? String(raw.currentEligibleLevel) : null,
    currentEligibleLevelOrder: toNumber(raw.currentEligibleLevelOrder),
    nextBonusDueAt: raw.nextBonusDueAt ? String(raw.nextBonusDueAt) : null,
    qualifiedAt: raw.qualifiedAt ? String(raw.qualifiedAt) : null,
    isCurrentlyQualified: Boolean(raw.isCurrentlyQualified),
    positionStatus: {
      activeDirectCount: toNumber(ensureRecord(raw.positionStatus).activeDirectCount),
      activeTeamCount: toNumber(ensureRecord(raw.positionStatus).activeTeamCount),
      directLv1Count: toNumber(ensureRecord(raw.positionStatus).directLv1Count),
      directLv7Count: toNumber(ensureRecord(raw.positionStatus).directLv7Count),
      directLv8Count: toNumber(ensureRecord(raw.positionStatus).directLv8Count),
      directLv9Count: toNumber(ensureRecord(raw.positionStatus).directLv9Count),
      lastCheckedAt: ensureRecord(raw.positionStatus).lastCheckedAt
        ? String(ensureRecord(raw.positionStatus).lastCheckedAt)
        : null,
    },
    summary: {
      directTotalMembers: toNumber(summary.directTotalMembers),
      directEligibleMembers: toNumber(summary.directEligibleMembers),
      directTotalBalance: String(summary.directTotalBalance ?? "0"),
      directEligibleBalance: String(summary.directEligibleBalance ?? "0"),
      teamTotalMembers: toNumber(summary.teamTotalMembers),
      teamEligibleMembers: toNumber(summary.teamEligibleMembers),
      teamTotalBalance: String(summary.teamTotalBalance ?? "0"),
      teamEligibleBalance: String(summary.teamEligibleBalance ?? "0"),
      minimumEligibleTeamBalance: summary.minimumEligibleTeamBalance
        ? String(summary.minimumEligibleTeamBalance)
        : null,
      lastCalculatedAt: summary.lastCalculatedAt ? String(summary.lastCalculatedAt) : null,
    },
    levelSettings: ensureArray(raw.levelSettings).map((item) => {
      const row = ensureRecord(item);
      return {
        levelCode: String(row.levelCode ?? ""),
        qualificationText: String(row.qualificationText ?? ""),
        directRequirement: toNumber(row.directRequirement),
        directLevelCode: row.directLevelCode ? String(row.directLevelCode) : null,
        teamRequirement: toNumber(row.teamRequirement),
        bonusPercent: toNumber(row.bonusPercent),
        promotionRewardUsdt: toNumber(row.promotionRewardUsdt),
        bonusBase: String(row.bonusBase ?? "team"),
        isEnabled: Boolean(row.isEnabled),
        sortOrder: toNumber(row.sortOrder),
      };
    }),
    tree: {
      rootUserId: tree.rootUserId !== undefined && tree.rootUserId !== null ? toNumber(tree.rootUserId) : null,
      totalNodes: toNumber(tree.totalNodes),
      maxDepth: toNumber(tree.maxDepth),
      nodes: ensureArray(tree.nodes).map((item) => {
        const row = ensureRecord(item);
        const nestedUser = ensureRecord(row.user);
        return {
          id: toNumber(row.id),
          pid: row.pid !== undefined && row.pid !== null ? toNumber(row.pid) : undefined,
          name: String(row.name ?? nestedUser.name ?? `User ${row.id ?? ""}`),
          email: String(row.email ?? nestedUser.email ?? ""),
          profilePhoto: toAbsoluteAssetUrl(
            typeof row.profilePhoto === "string"
              ? row.profilePhoto
              : typeof row.profile_photo === "string"
              ? row.profile_photo
              : typeof row.photo === "string"
              ? row.photo
              : typeof row.photo_url === "string"
              ? row.photo_url
              : typeof row.photoUrl === "string"
              ? row.photoUrl
              : typeof row.userImage === "string"
              ? row.userImage
              : typeof row.user_image === "string"
              ? row.user_image
              : typeof row.avatarUrl === "string"
              ? row.avatarUrl
              : typeof row.avatar_url === "string"
              ? row.avatar_url
              : typeof row.avatar === "string"
              ? row.avatar
              : typeof row.imageUrl === "string"
              ? row.imageUrl
              : typeof row.image_url === "string"
              ? row.image_url
              : typeof nestedUser.profilePhoto === "string"
              ? nestedUser.profilePhoto
              : typeof nestedUser.profile_photo === "string"
              ? nestedUser.profile_photo
              : typeof nestedUser.avatarUrl === "string"
              ? nestedUser.avatarUrl
              : typeof nestedUser.avatar_url === "string"
              ? nestedUser.avatar_url
              : typeof nestedUser.photo === "string"
              ? nestedUser.photo
              : null
          ),
          levelCode: row.levelCode ? String(row.levelCode) : null,
          levelRank: toNumber(row.levelRank),
          status: String(row.status ?? "inactive"),
          walletBalance: String(row.walletBalance ?? "0"),
          directCount: toNumber(row.directCount),
          depth: toNumber(row.depth),
          eligible: Boolean(row.eligible),
          isRoot: Boolean(row.isRoot),
        };
      }),
    },
    promotionHistory: ensureArray(raw.promotionHistory).map((item) => {
      const row = ensureRecord(item);
      return {
        id: toNumber(row.id),
        levelCode: String(row.levelCode ?? ""),
        levelRank: toNumber(row.levelRank),
        rewardAmount: String(row.rewardAmount ?? "0"),
        bonusPercent: String(row.bonusPercent ?? "0"),
        achievedAt: String(row.achievedAt ?? ""),
        createdAt: String(row.createdAt ?? ""),
      };
    }),
    bonusPayoutHistory: ensureArray(raw.bonusPayoutHistory).map((item) => {
      const row = ensureRecord(item);
      return {
        id: toNumber(row.id),
        levelCode: String(row.levelCode ?? ""),
        levelRank: toNumber(row.levelRank),
        bonusPercent: String(row.bonusPercent ?? "0"),
        eligibleBalance: String(row.eligibleBalance ?? "0"),
        eligibleMembers: toNumber(row.eligibleMembers),
        qualifiedDirectMembers: toNumber(row.qualifiedDirectMembers),
        payoutAmount: String(row.payoutAmount ?? "0"),
        periodStartedAt: String(row.periodStartedAt ?? ""),
        periodEndedAt: String(row.periodEndedAt ?? ""),
        status: String(row.status ?? "SUCCESS"),
        createdAt: String(row.createdAt ?? ""),
      };
    }),
    recurringBonusHistory: ensureArray(raw.recurringBonusHistory).map((item) => {
      const row = ensureRecord(item);
      return {
        id: toNumber(row.id),
        levelCode: String(row.levelCode ?? ""),
        percent: String(row.percent ?? "0"),
        baseAmount: String(row.baseAmount ?? "0"),
        bonusAmount: String(row.bonusAmount ?? "0"),
        cycleFrom: String(row.cycleFrom ?? ""),
        cycleTo: String(row.cycleTo ?? ""),
        dueAt: String(row.dueAt ?? ""),
        paidAt: row.paidAt ? String(row.paidAt) : null,
        status: String(row.status ?? "paid"),
        skipReason: row.skipReason ? String(row.skipReason) : null,
        createdAt: String(row.createdAt ?? ""),
      };
    }),
  };
};

export const fetchReferralDashboard = async (): Promise<ReferralDashboard> => {
  const response = await api.get(REFERRAL_ENDPOINTS.dashboard);
  const payload = ensureRecord(unwrap(response.data));
  const statsRaw = ensureRecord(payload.stats);

  const metrics = metricsConfig
    .map((config) => mapMetric(statsRaw, config))
    .filter((metric): metric is ReferralMetric => Boolean(metric));

  const primaryCode = mapPrimaryCode(payload.primary ?? payload.primaryCode ?? {});

  const tiers = ensureArray(payload.tiers).map(mapTier);
  const referrals = ensureArray(payload.referrals ?? payload.invites).map(mapReferralEntry);

  return {
    metrics,
    primaryCode,
    tiers,
    referrals,
    mlm: mapMlm(payload.mlm),
  };
};

export const fetchReferralIncomeHistory = async (params?: { page?: number; limit?: number }) => {
  const response = await api.get(REFERRAL_ENDPOINTS.history, { params });
  const payload = ensureRecord(unwrap(response.data));
  const items = ensureArray(payload.items).map((value) => {
    const raw = ensureRecord(value);
    return {
      id: toNumber(raw.id),
      txnId: String(raw.txnId ?? raw.txn_id ?? ''),
      date: String(raw.date ?? raw.createdAt ?? ''),
      incomeType: String(raw.incomeType ?? raw.income_type ?? ''),
      sourceUser: raw.sourceUser !== undefined ? String(raw.sourceUser) : raw.source_user_email ? String(raw.source_user_email) : null,
      sourceUserEmail: raw.sourceUserEmail !== undefined ? String(raw.sourceUserEmail) : raw.source_user_email ? String(raw.source_user_email) : null,
      sourceUserName: raw.sourceUserName !== undefined ? String(raw.sourceUserName) : raw.source_user_name ? String(raw.source_user_name) : null,
      sourceUserLabel:
        raw.sourceUserLabel !== undefined
          ? String(raw.sourceUserLabel)
          : raw.source_user_label
          ? String(raw.source_user_label)
          : raw.sourceUser !== undefined
          ? String(raw.sourceUser)
          : raw.source_user_email
          ? String(raw.source_user_email)
          : null,
      previousBalance: toNumber(raw.previousBalance ?? raw.previous_balance),
      amount: toNumber(raw.amount ?? raw.mlmEarned ?? raw.mlm_earned),
      newBalance: toNumber(raw.newBalance ?? raw.new_balance),
      status: String(raw.status ?? 'SUCCESS'),
      remark: raw.remark !== undefined ? String(raw.remark) : null,
    } satisfies ReferralIncomeHistoryItem;
  });

  const pagination = ensureRecord(payload.pagination);
  return {
    items,
    pagination: {
      page: toNumber(pagination.page, params?.page ?? 1),
      limit: toNumber(pagination.limit, params?.limit ?? 10),
      total: toNumber(pagination.total),
      totalPages: toNumber(pagination.totalPages),
    },
  };
};

export const toggleReferralPromo = async (active: boolean): Promise<boolean> => {
  const response = await api.post(REFERRAL_ENDPOINTS.promo, { active });
  const payload = ensureRecord(unwrap(response.data));
  if (payload.promoActive !== undefined) return Boolean(payload.promoActive);
  if (payload.active !== undefined) return Boolean(payload.active);
  return active;
};

export const exportReferralsCsv = async (): Promise<Blob> => {
  const response = await api.get(REFERRAL_ENDPOINTS.export, { responseType: "blob" });
  return response.data as Blob;
};
