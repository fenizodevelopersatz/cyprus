import api from "../../../app/axios";
import { ADMIN_ENDPOINTS } from "../../../app/apiRoutes";
import type { StakingEarningsReport } from "../../staking/api/staking.api";
import type { SipOrder, SipPlan, SipSubscription } from "../../sip/api/sip.api";

const unwrap = <T,>(raw: T): T => {
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>) && (raw as any).data !== raw) {
    return unwrap((raw as any).data);
  }
  return raw;
};

export type AdminSession = {
  id: number | string;
  name?: string;
  email: string;
  roles: string[];
  permissions?: string[];
  lastLoginAt?: string;
};

export type AdminKycSidebarSummaryItem = {
  id: string | number;
  userId: string | number;
  createdAt: string;
  updatedAt?: string | null;
  status: string;
  email?: string | null;
  displayName?: string | null;
};

export type AdminKycSidebarSummary = {
  pendingCount: number;
  latestSubmittedAt?: string | null;
  items: AdminKycSidebarSummaryItem[];
};

export type AdminUser = {
  id: number | string;
  email: string;
  name?: string | null;
  displayName?: string | null;
  profilePhoto?: string | null;
  country?: string | null;
  kycLevel?: number | null;
  kycVerified?: boolean;
  status?: string;
  tier?: string | null;
  roles?: string[];
  hasPassword?: boolean;
  passwordChangedAt?: string | null;
  twoFactorEnabled?: boolean;
  googleAuthConfigured?: boolean;
  lastActiveAt?: string;
  createdAt?: string;
  currentLevelCode?: string | null;
  currentLevelRank?: number | null;
  currentEligibleLevelCode?: string | null;
  currentEligibleLevelOrder?: number | null;
  previousAchievedLevelCode?: string | null;
  previousAchievedLevelRank?: number | null;
  fallbackHappened?: boolean;
  isCurrentlyQualified?: boolean;
  activeDirectCount?: number;
  activeTeamCount?: number;
  directLv1Count?: number;
  directLv7Count?: number;
  directLv8Count?: number;
  directLv9Count?: number;
  qualifiedAt?: string | null;
  lastCheckedAt?: string | null;
  nextBonusDueAt?: string | null;
};

export type FuturesContractAdmin = {
  symbol: string;
  status?: string;
  isEnabled?: boolean;
  rawSymbol?: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  lotSize: number;
  minLeverage?: number;
  maxLeverage?: number;
  markPrice?: number;
  fundingRate?: number;
  fundingTimestamp?: string;
  maintenanceMarginRate?: number;
};

export type FuturesAccountAdmin = {
  equity: number;
  balance: number;
  marginUsed: number;
  availableMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
};

export type FuturesPositionAdmin = {
  id: string | number;
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice?: number;
  status: string;
  leverage: number;
  createdAt?: string;
};

export type FuturesTradeAdmin = {
  id: string | number;
  symbol: string;
  side: "LONG" | "SHORT";
  price: number;
  qty: number;
  realizedPnl?: number;
  status?: string;
  timestamp: string | number;
};

export type AdminWithdrawal = {
  id: string | number;
  txn_id?: string;
  userId: string | number;
  email?: string;
  userName?: string | null;
  profilePhoto?: string | null;
  userStatus?: string | null;
  kycVerified?: boolean;
  asset: string;
  amount: number;
  memo?: string | null;
  status: "pending" | "approved" | "rejected" | string;
  address: string;
  explorerUrl?: string | null;
  txExplorerUrl?: string | null;
  txHash?: string | null;
  requestedAt?: string;
  updatedAt?: string;
  chain?: string;
  to?: string;
  meta?: Record<string, unknown>;
  adminNotes?: string | null;
  broadcastedAt?: string;
  confirmedAt?: string;
  createdAt?: string;
};

export type AdminWithdrawQueueResponse = {
  items: AdminWithdrawal[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type AdminWithdrawHistoryResponse = {
  items: AdminWithdrawal[];
  summary: {
    totalUsdt: string;
    totalErc20: string;
    totalBep20: string;
    totalTrc20: string;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type AdminWalletLiveBalances = {
  totalUsdt: string;
  totalErc20: string;
  totalBep20: string;
  totalTrc20: string;
  wallets: Array<{
    network: string;
    asset: string;
    label: string;
    address: string;
    explorerUrl?: string | null;
    balance: string;
  }>;
};

export type AdminFiatDeposit = {
  id: string | number;
  userId: string | number;
  user?: { email?: string };
  method: string;
  wallet: string;
  amount: number;
  currency: string;
  status: string;
  proofUrl?: string;
  referenceCode?: string;
  notes?: string;
  createdAt: string;
};

export type AdminBalances = {
  asset: string;
  spot: number;
  futures: number;
  total: number;
};

export type AdminUserWalletOverview = {
  userId: number | string;
  internal: {
    mainWalletBalance: string;
    availableBalance: string;
    depositTotal: string;
    totalWithdrawals: string;
    totalEarnings: string;
  };
  live: {
    totalUsdt: string;
    totalNative: {
      eth: string;
      bnb: string;
      trx: string;
    };
    totalToken: {
      erc20: string;
      bep20: string;
      trc20: string;
    };
    networks: Array<{
      network: string;
      walletNetwork: string;
      address: string;
      explorerUrl?: string | null;
      nativeAsset: string;
      nativeBalance: string;
      tokenAsset: string;
      tokenBalance: string;
      live: boolean;
      error?: string | null;
    }>;
  };
};

export type AdminDepositAddress = {
  asset: string;
  chain: string;
  address: string;
  qrCode?: string;
};

export type AdminDepositRecord = {
  id: number | string;
  txn_id?: string;
  userId: number | string;
  userName?: string | null;
  userEmail?: string | null;
  network: string;
  networkKey: string;
  depositAddress: string;
  fromAddress?: string | null;
  txHash: string;
  explorerUrl?: string | null;
  tokenContract?: string | null;
  amount: string;
  status: string;
  confirmationCount: number;
  isSwept: boolean;
  createdAt: string;
};

export type AdminDepositSummary = {
  totalUsdt: string;
  totalErc: string;
  totalBep: string;
  totalTrc: string;
};

export type AdminTreasuryWallet = {
  network: string;
  label: string;
  address: string;
  contractAddress?: string | null;
  balance: string;
};

export type AdminTreasuryOverview = {
  wallets: AdminTreasuryWallet[];
  totalPlatformBalance: {
    byNetwork: Record<string, string>;
    total: string;
  };
  sweepStatus: {
    pendingDeposits: number;
    lastSweepTime?: string | null;
    sweepCount: number;
  };
  custodial?: {
    wallets: Array<{
      network: string;
      address: string;
      token: string;
      usdtBalance: string;
    }>;
    pendingGasTopups: number;
    pendingSweeps: number;
    totalTreasuryBalance: Record<string, string>;
  };
};

export type AdminSweepRecord = {
  id: number | string;
  userId: number | string;
  network: string;
  networkKey: string;
  sourceWalletAddress: string;
  destinationAdminWalletAddress: string;
  amount: string;
  gasFee?: string | null;
  gasAsset?: string | null;
  txHash?: string | null;
  explorerUrl?: string | null;
  sweepStatus: string;
  triggerType?: string | null;
  errorMessage?: string | null;
  sweptAt?: string | null;
  createdAt: string;
};

export type AdminSweepSummary = AdminDepositSummary & {
  insufficientGasCount: number;
};

export type AdminCustodialSweepRecord = {
  id: number | string;
  userId: number | string;
  network: string;
  token: string;
  sourceWalletAddress: string;
  destinationAdminWalletAddress: string;
  tokenContract?: string | null;
  depositTransactionId?: number | string | null;
  usdtAmountDecimal: string;
  estimatedGasFeeDecimal?: string | null;
  gasAsset?: string | null;
  gasStatus: string;
  gasTopupTxHash?: string | null;
  sweepTxHash?: string | null;
  status: string;
  triggerType?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string;
  sweptAt?: string | null;
};

export type AdminGasFundingRecord = {
  id: number | string;
  userId: number | string;
  network: string;
  sourceAdminWalletAddress: string;
  destinationUserWalletAddress: string;
  gasAsset: string;
  amountDecimal: string;
  txHash?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
  sweepTransactionId?: number | string | null;
};

export type AdminAuditLog = {
  id: string | number;
  actor: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type AdminWebsocketStatus = {
  connected: boolean;
  uptimeSeconds?: number;
  lastEventAt?: string;
};

export type AdminServices = {
  syncedAt: string;
  services: Array<{ name: string; status: string; latencyMs: number }>;
};

export type AdminDashboardUserSummary = {
  total: number;
  verified: number;
  new24h: number;
  active24h?: number;
  kycPending?: number;
  retention24h?: number | null;
};

export type AdminDashboardFundingSummary = {
  crypto?: {
    inflow24h?: number;
    outflow24h?: number;
    net24h?: number;
    pendingWithdrawals?: number;
  };
  fiat?: {
    inflow24h?: number;
    totalRange?: number;
    pending?: number;
    pendingAmount?: number;
    rejections24h?: number;
  };
};

export type AdminDashboardWithdrawalsSummary = {
  cryptoPending?: number;
  fiatPending?: number;
  avgDurationMins?: number;
};

export type AdminDashboardStakingSummary = {
  tvlUsd?: number;
  averageApr?: number;
  activeLockups?: number;
  nextRewardCycle?: string | null;
  leaderboard?: Array<{
    id: string | number;
    label: string;
    asset?: string;
    aprPercent?: number;
    stats?: { totalLockedUsd?: number };
  }>;
  rewards24h?: number;
};

export type AdminDashboardMarketSummary = {
  listings?: number;
  perpPairs?: number;
  spotVol24h?: number;
  futuresOpenInterest?: number;
};

export type AdminDashboardChartPoint<T extends Record<string, unknown>> = T & { date: string };

export type AdminDashboardOverviewCharts = {
  dailyUsers?: Array<AdminDashboardChartPoint<{ total?: number; active?: number; new?: number }>>;
  fundingFlows?: Array<AdminDashboardChartPoint<{ cryptoIn?: number; cryptoOut?: number; fiatIn?: number }>>;
  stakingRecent?: Array<{
    id: string | number;
    userId?: string | number;
    asset?: string;
    amount?: number;
    aprPercent?: number;
    status?: string;
    stakedAt?: string;
  }>;
};

export type AdminDashboardSpotLeader = {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  lastPrice?: number;
  changePct?: number;
  volume24h?: number;
  tradedAmount?: number;
};

export type AdminDashboardStakingPackageLeader = {
  id: number | string;
  label: string;
  asset?: string;
  stats?: { totalLockedUsd?: number };
  sharePct?: number;
};

export type AdminDashboardStakingParticipantLeader = {
  userId: number | string;
  email?: string;
  activePositions?: number;
  lockedUsd?: number;
};

export type AdminDashboardMarketLeaders = {
  spot?: AdminDashboardSpotLeader[];
  staking?: {
    packages?: AdminDashboardStakingPackageLeader[];
    participants?: AdminDashboardStakingParticipantLeader[];
  };
};

export type AdminDashboardQueueItem = {
  id: string | number;
  userId?: string | number;
  email?: string;
  user?: { id?: string | number; email?: string; name?: string | null };
  amount?: string | number;
  asset?: string;
  currency?: string;
  method?: string;
  status?: string;
  createdAt?: string;
  submittedAt?: string;
  memo?: string | null;
  meta?: Record<string, unknown>;
};

export type AdminDashboardQueues = {
  kyc?: AdminDashboardQueueItem[];
  withdrawals?: AdminDashboardQueueItem[];
  fiatDeposits?: AdminDashboardQueueItem[];
};

export type AdminDashboardActivity = {
  id?: string | number;
  type: string;
  summary?: string;
  description?: string | null;
  subtitle?: string | null;
  amount?: number | null;
  asset?: string | null;
  currency?: string | null;
  user?: { id?: string | number; email?: string; avatarUrl?: string | null };
  timeAgo?: string | null;
  occurredAt?: string;
  occurredAtUnix?: number | null;
  timestamp?: string;
  metadata?: {
    status?: string | null;
    method?: string | null;
    chain?: string | null;
    packageLabel?: string | null;
    [key: string]: unknown;
  };
};

export type AdminDashboardOverview = {
  syncedAt: string;
  summary: {
    users: AdminDashboardUserSummary;
    funding?: AdminDashboardFundingSummary;
    withdrawals?: AdminDashboardWithdrawalsSummary;
    staking?: AdminDashboardStakingSummary;
    markets?: AdminDashboardMarketSummary;
  };
  charts?: AdminDashboardOverviewCharts;
  marketLeaders?: AdminDashboardMarketLeaders;
  queues?: AdminDashboardQueues;
  recentActivity?: AdminDashboardActivity[];
  services?: AdminServices["services"];
};

export type AdminDashboardActivityResponse = {
  syncedAt?: string;
  items: AdminDashboardActivity[];
  nextCursor?: string | null;
};

export type AdminSettings = {
  siteName: string;
  siteLogoUrl?: string;
  siteFaviconUrl?: string;
  maintenanceMode: boolean;
  enableKyc: boolean;
  enableLanguageSwitcher: boolean;
  enableDarkMode: boolean;
  darkModeDefault: boolean;
  requireReferralCode: boolean;
  withdrawalLimitKyc: number;
  withdrawalLimitNonKyc: number;
  withdrawalAdminFeePercent?: number;
  withdrawalLockPeriodDays?: number;
  earlyWithdrawalPenaltyPercent?: number;
  rewardReductionEnabled?: boolean;
  rewardReductionType?: string;
  minimumWithdrawalAmount?: number;
  maximumWithdrawalAmount?: number;
  withdrawalNote?: string;
  isWithdrawalEnabled?: boolean;
  defaultSwapMarket: string;
  tradeMakerFee: number;
  tradeTakerFee: number;
  referralFee: number;
  transferCommission: number;
  disableTrades: boolean;
  mailType: string;
  mailHost: string;
  mailPort: number;
  mailUsername: string;
  mailPassword: string;
  mailSenderName: string;
  mailSenderEmail: string;
  mailEncryption: string;
  notificationAdminEmail: string;
  notifyCryptoDeposits: boolean;
  notifyCryptoWithdrawals: boolean;
  notifyFiatDeposits: boolean;
  notifyFiatWithdrawals: boolean;
  notifyKyc: boolean;
  notifyNewUser: boolean;
  stripePublicKey: string;
  stripeSecretKey: string;
  stripeBaseCurrency: string;
  recaptchaEnabled: boolean;
  recaptchaSiteKey: string;
  recaptchaSecretKey: string;
  socialYoutube: string;
  socialFacebook: string;
  socialTelegram: string;
  socialTwitter: string;
  socialInstagram: string;
  socialLinkedin: string;
  sipEnabled?: boolean;
  sipSupportedFiats?: string[] | string;
  sipScheduleOptions?: string[] | string;
  sipDefaultFrequency?: string;
  sipMinFiatAmount?: number;
  sipMaxFiatAmount?: number | null;
  sipMinAssetQuantity?: string | null;
  sipMaxAssetQuantity?: string | null;
  sipFxHints?: Record<string, number> | string | null;
  sipHeroTitle?: string;
  sipHeroSubtitle?: string;
  sipHeroSections?: Array<{ title?: string; body?: string }> | string | null;
  sipHeroCtaLabel?: string;
  sipHeroCtaHelper?: string;
  currentPassword?: string;
  newPassword?: string;
};

export type AdminSignalAsset = {
  id: number | string;
  asset: string;
  network: string;
  displayName: string;
  networkType: "EVM" | "TRON" | string;
  minDeposit: string | number;
  minWithdraw: string | number;
  withdrawFeeType: "FIXED" | "PERCENT" | string;
  withdrawFee: string | number;
  rpcUrl?: string | null;
  chainId?: string | null;
  contractAddress?: string | null;
  decimals: number;
  depositWallet?: string | null;
  hotWallet?: string | null;
  privateKey?: string | null;
  hasPrivateKey?: boolean;
  confirmations: number;
  fullHost?: string | null;
  status: "ENABLED" | "DISABLED" | string;
  isEnabled: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminSignalAssetPayload = {
  asset: string;
  network: string;
  displayName: string;
  networkType: "EVM" | "TRON";
  minDeposit: string | number;
  minWithdraw: string | number;
  withdrawFeeType: "FIXED" | "PERCENT";
  withdrawFee: string | number;
  rpcUrl?: string;
  chainId?: string;
  contractAddress?: string;
  decimals: number;
  depositWallet?: string;
  hotWallet?: string;
  privateKey?: string;
  confirmations: number;
  fullHost?: string;
  status: "ENABLED" | "DISABLED";
  isEnabled: boolean;
  sortOrder?: number;
};

export type AdminSignalPackageSettings = {
  minDeposit: string;
  maxDeposit: string;
  investmentPerTradePct: string;
  perTradeProfitPct: string;
  dailyRoiPct: string;
  unlimitedLastPackage: boolean;
  autoPackageAssignment: boolean;
  packageUpgradeAllowed: boolean;
};

export type AdminSignalPackage = {
  id: number | string;
  name: string;
  minAmount: string;
  maxAmount: string | null;
  unlimitedMax: boolean;
  perTradeCommissionPct: string;
  signalsPerDay: number;
  requiredLevel: number;
  status: "ACTIVE" | "INACTIVE" | string;
  description: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminSignalPackagePayload = {
  name: string;
  minAmount: string | number;
  maxAmount?: string | number | null;
  unlimitedMax: boolean;
  perTradeCommissionPct: string | number;
  signalsPerDay: number;
  requiredLevel: number;
  status: "ACTIVE" | "INACTIVE";
  description?: string;
  sortOrder: number;
};

export type AdminSignalPackageModule = {
  settings: AdminSignalPackageSettings;
  packages: AdminSignalPackage[];
};

export type AdminIncomeLedgerRow = {
  id: number | string;
  txn_id: string;
  order_id?: string | null;
  userId?: number | string;
  primary_user_id: number | string;
  userName: string;
  userEmail: string;
  referralCode?: string | null;
  incomeType: string;
  sourceUserId?: number | string | null;
  source_user_id?: number | string | null;
  sourceUser?: string | null;
  reference_type?: string | null;
  reference_id?: string | number | null;
  level?: string | null;
  reference?: string | number | null;
  asset?: string | null;
  remark?: string | null;
  amount: number;
  status: string;
  event_at?: string;
  createdAt?: string;
  updated_at?: string;
};

export type AdminIncomeLedgerSummary = {
  totalDirectSponsorIncome: number;
  totalJoinedIncome: number;
  totalLevelBonus10DayIncome: number;
  totalLevelPromotionRewardIncome: number;
  totalSignalIncome: number;
  totalCombinedIncome: number;
  totalBeneficiaryUsers: number;
};

export type AdminIncomeLedgerUserSummaryRow = {
  userId: number | string;
  userName: string;
  userEmail: string;
  referralCode?: string | null;
  totalIncome: number;
  directSponsor: number;
  joined: number;
  levelBonus: number;
  levelReward: number;
  signalIncome: number;
  records: number;
};

export type PaginatedResult<T> = {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type AdminControlGlobalRules = {
  id: number | string;
  investmentPerTradePercent: number;
  dailyPercentPerTrade: number;
  signalValidityMinutes: number;
  telegramChannelUrl?: string | null;
  isActive: boolean;
  updatedBy?: number | string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminControlTradeSlot = {
  id: number | string;
  slotName: string;
  slotTime: string;
  isEnabled: boolean;
  sortOrder: number;
};

export type AdminControlPackageTier = {
  id: number | string;
  packageName: string;
  minAmount: number;
  maxAmount: string;
  signalsPerDay: number;
  requiredLevel: string;
  isEnabled: boolean;
  sortOrder: number;
};

export type AdminControlBirthdayGift = {
  id: number | string;
  isEnabled: boolean;
  minimumEligibleLevel: string;
  giftAmount: number;
  sortOrder?: number;
  isActive: boolean;
  updatedBy?: number | string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminControlSettings = {
  globalRules: AdminControlGlobalRules;
  tradeSlots: AdminControlTradeSlot[];
  packageTiers: AdminControlPackageTier[];
  birthdayGift: AdminControlBirthdayGift[];
};

export type AdminLevelManagementLevel = {
  id: number | string;
  levelCode: string;
  qualificationText: string;
  bonusPercent: number;
  promotionRewardUsdt: number;
  isEnabled: boolean;
  sortOrder: number;
};

export type AdminLevelManagementConfig = {
  id?: number | string;
  directReferralNote: string;
  newUserRewardNote: string;
  levelAchievementNote: string;
  salaryRewardNote: string;
  oneTimeRewardNote: string;
  minimumDepositEligibilityNote: string;
  minimumEligibleDeposit: number;
  directSponsorCommissionPercent: number;
  joinedCommissionPercent: number;
  isCommissionActive: boolean;
  isActive?: boolean;
  updatedBy?: number | string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminLevelManagementSettings = {
  levels: AdminLevelManagementLevel[];
  config: AdminLevelManagementConfig;
};

export type UpdateAdminLevelManagementSettingsPayload = {
  levels: AdminLevelManagementLevel[];
  config: AdminLevelManagementConfig;
};

export type AdminSignalHistoryDayWiseRow = {
  date: string;
  "9": string | null;
  "12": string | null;
  "3": string | null;
  "6": string | null;
  createdAt?: string;
  slotTokens?: Record<
    string,
    {
      slotId: number | string;
      slotName?: string | null;
      slotTime: string;
      batchToken: string;
    }
  >;
};

export type AdminSignalHistoryBatch = {
  id: number | string;
  slotId: number | string;
  slotName?: string | null;
  slotDate: string;
  slotTime: string;
  batchToken: string;
  status: string;
  slotLabel?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminTradeSlotBatch = AdminSignalHistoryBatch;

export type AdminSignalHistoryTokenDetail = {
  batch: AdminSignalHistoryBatch;
  signals: Array<Record<string, unknown>>;
  userSignalLogs: Array<Record<string, unknown>>;
};

export type UpdateAdminControlSettingsPayload = {
  globalRules: {
    investmentPerTradePercent: number;
    dailyPercentPerTrade: number;
    signalValidityMinutes: number;
    telegramChannelUrl?: string | null;
  };
  tradeSlots: Array<{
    id: number | string;
    slotName: string;
    slotTime: string;
    isEnabled: boolean;
    sortOrder: number;
  }>;
  packageTiers: Array<{
    id: number | string;
    packageName: string;
    minAmount: number;
    maxAmount: string;
    signalsPerDay: number;
    requiredLevel: string;
    isEnabled: boolean;
    sortOrder: number;
  }>;
  birthdayGift: Array<{
    id?: number | string;
    isEnabled: boolean;
    minimumEligibleLevel: string;
    giftAmount: number;
    sortOrder?: number;
  }>;
  generatedTokens?: Record<string, string>;
};

export type AdminKycUser = {
  id: number | string;
  email: string;
  displayName?: string | null;
  profilePhoto?: string | null;
  country?: string | null;
  kycLevel?: number | null;
};

export type AdminKycRequest = {
  id: number | string;
  userId: number | string;
  submissionId: string;
  status: string;
  resubmissionRequired?: boolean;
  notes?: string | null;
  reviewerId?: number | string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
  user: AdminKycUser;
};

export type AdminKycDocument = {
  id: number | string;
  submissionId: string;
  type: string;
  filename: string;
  status: string;
  uploadedAt: string;
  updatedAt: string;
  notes?: string | null;
  isSecondary?: boolean;
  url?: string;
  previewUrl?: string;
  mimeType?: string;
};

export type AdminKycActivity = {
  id: number | string;
  event: string;
  message: string;
  createdAt: string;
};

export type AdminKycRequestDetail = AdminKycRequest & {
  documents: AdminKycDocument[];
  activity: AdminKycActivity[];
};

export type AdminKycRequestListResponse = {
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  items: AdminKycRequest[];
};

export type AdminOrderUser = {
  id: number | string;
  email: string;
  displayName?: string | null;
  country?: string | null;
};

export type AdminOrder = {
  id: number | string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  price: number;
  qty: number;
  filled?: number;
  createdAt: string;
  updatedAt?: string | null;
  userId: number | string;
  user?: AdminOrderUser;
};

export type AdminTrade = {
  id: number | string;
  symbol: string;
  side: string;
  price: number;
  qty: number;
  createdAt: string;
  userId: number | string;
  user?: AdminOrderUser;
};

export type AdminSipPlan = SipPlan & {
  createdAt?: string;
  updatedAt?: string;
  subscriptionsCount?: number;
};

export type AdminSipPlanPayload = {
  asset: string;
  quoteCurrency: string;
  nickname: string;
  description?: string;
  status?: string;
  allowedFrequencies: string[];
  allowAmountInput?: boolean;
  allowQuantityInput?: boolean;
  minFiatAmount?: string | number | null;
  maxFiatAmount?: string | number | null;
  minAssetQuantity?: string | number | null;
  maxAssetQuantity?: string | number | null;
};

export type AdminSipSubscription = SipSubscription & {
  user?: { id: number | string; email?: string; name?: string | null };
};

export type AdminSipOrder = SipOrder & {
  user?: { id: number | string; email?: string; name?: string | null };
};

export async function fetchAdminSession(): Promise<AdminSession> {
  const { data } = await api.get(ADMIN_ENDPOINTS.session);
  return unwrap<AdminSession>(data);
}

export async function fetchAdminDashboardOverview(params?: { rangeDays?: number; asset?: string; force?: boolean }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.dashboard.overview(params));
  const payload = unwrap<AdminDashboardOverview | { overview: AdminDashboardOverview }>(data);
  if (payload && typeof payload === "object" && "overview" in (payload as Record<string, unknown>)) {
    return (payload as { overview: AdminDashboardOverview }).overview;
  }
  return payload as AdminDashboardOverview;
}

export async function fetchAdminDashboardActivity(params?: { limit?: number; cursor?: string }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.dashboard.activity(params));
  const payload = unwrap<
    | AdminDashboardActivityResponse
    | { items: AdminDashboardActivity[]; nextCursor?: string | null }
    | AdminDashboardActivity[]
  >(data);

  if (Array.isArray(payload)) {
    return { items: payload, nextCursor: null, syncedAt: undefined };
  }

  const normalised = payload as Partial<AdminDashboardActivityResponse> & {
    results?: AdminDashboardActivity[];
    data?: AdminDashboardActivity[];
  };

  const items = normalised.items ?? normalised.results ?? normalised.data ?? [];
  return {
    items,
    nextCursor: normalised.nextCursor ?? null,
    syncedAt:
      normalised.syncedAt ??
      (Array.isArray(payload)
        ? new Date().toISOString()
        : undefined),
  };
}

export async function fetchAdminServices(): Promise<AdminServices> {
  const { data } = await api.get(ADMIN_ENDPOINTS.services);
  return unwrap<AdminServices>(data);
}

export async function fetchAdminUsers(params?: {
  search?: string;
  limit?: number;
  page?: number;
  status?: string;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.users.list(params));
  return unwrap<{
    meta: { page: number; pageSize: number; total: number; totalPages: number };
    items: AdminUser[];
  }>(data);
}

export async function patchAdminUserStatus(userId: string | number, status: "active" | "inactive") {
  const { data } = await api.patch(ADMIN_ENDPOINTS.users.updateStatus(userId), { status });
  return unwrap<{ id: string | number; status: string }>(data);
}

export async function fetchAdminFuturesContracts(): Promise<FuturesContractAdmin[]> {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.contracts);
  return unwrap<FuturesContractAdmin[]>(data);
}

export type UpdateFuturesContractPayload = {
  enabled?: boolean;
  isEnabled?: boolean;
  status?: string;
  minLeverage?: number;
  maxLeverage?: number;
};

const normaliseContractPatchPayload = (symbol: string, payload: UpdateFuturesContractPayload) => {
  const body: UpdateFuturesContractPayload & { symbol: string } = { ...payload, symbol };

  if (typeof payload.enabled === "boolean") {
    if (typeof body.isEnabled !== "boolean") body.isEnabled = payload.enabled;
    if (!body.status) body.status = payload.enabled ? "enabled" : "disabled";
  } else if (typeof payload.isEnabled === "boolean") {
    if (typeof body.enabled !== "boolean") body.enabled = payload.isEnabled;
    if (!body.status) body.status = payload.isEnabled ? "enabled" : "disabled";
  } else if (typeof payload.status === "string") {
    const normalized = payload.status.toLowerCase();
    if (body.enabled === undefined) body.enabled = normalized === "enabled";
    if (body.isEnabled === undefined) body.isEnabled = normalized === "enabled";
  }

  return body;
};

export async function adminUpdateFuturesContract(symbol: string, payload: UpdateFuturesContractPayload) {
  const normalisedPayload = normaliseContractPatchPayload(symbol, payload);
  const { data } = await api.patch(ADMIN_ENDPOINTS.futures.updateContract(symbol), normalisedPayload);
  return unwrap<FuturesContractAdmin>(data);
}

export async function fetchAdminFuturesAccount(userId: string): Promise<FuturesAccountAdmin> {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.userAccount(userId));
  return unwrap<FuturesAccountAdmin>(data);
}

export async function fetchAdminFuturesPositions(userId: string, status?: string): Promise<FuturesPositionAdmin[]> {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.userPositions(userId, status));
  return unwrap<FuturesPositionAdmin[]>(data);
}

export async function fetchAdminFuturesTrades(userId: string): Promise<FuturesTradeAdmin[]> {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.userTrades(userId));
  return unwrap<FuturesTradeAdmin[]>(data);
}

export async function fetchAdminFuturesMark(symbol: string) {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.mark(symbol));
  return unwrap<{ symbol: string; price: number; ts?: number }>(data);
}

export async function fetchAdminFuturesFunding(symbol: string) {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.funding(symbol));
  return unwrap<{ symbol: string; rate: number; ts?: number }>(data);
}

export async function fetchAdminFuturesHistory(symbol: string, limit?: number) {
  const { data } = await api.get(ADMIN_ENDPOINTS.futures.history(symbol, limit));
  return unwrap<Array<{ ts: number; price: number }>>(data);
}

export async function adminOpenPosition(userId: string, payload: Record<string, unknown>) {
  const { data } = await api.post(ADMIN_ENDPOINTS.futures.openPosition(userId), payload);
  return unwrap(data);
}

export async function adminUpdateTriggers(userId: string, payload: Record<string, unknown>) {
  const { data } = await api.post(ADMIN_ENDPOINTS.futures.updateTriggers(userId), payload);
  return unwrap(data);
}

export async function adminClosePosition(userId: string, payload: Record<string, unknown>) {
  const { data } = await api.post(ADMIN_ENDPOINTS.futures.closePosition(userId), payload);
  return unwrap(data);
}

export async function fetchAdminWithdrawals(params?: { status?: string; userId?: string; limit?: number }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.withdrawals(params));
  return unwrap<{ items: AdminWithdrawal[]; total?: number } | AdminWithdrawal[]>(data);
}

export async function adminApproveWithdrawal(id: string, payload?: { txHash?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.approveWithdrawal(id), payload ?? {});
  return unwrap<AdminWithdrawal>(data);
}

export async function adminRejectWithdrawal(id: string, payload?: { reason?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.rejectWithdrawal(id), payload ?? {});
  return unwrap<AdminWithdrawal>(data);
}

export async function adminAdjustBalance(userId: string, payload: {
  asset: string;
  amount: number;
  operation: "credit" | "debit";
  namespace?: string;
  memo?: string;
  orderId?: string;
}) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.adjustBalance(userId), payload);
  return unwrap(data);
}

export async function fetchAdminBalances(userId: string) {
  const { data } = await api.get(ADMIN_ENDPOINTS.users.balances(userId));
  return unwrap<AdminBalances[]>(data);
}

export async function fetchAdminUserOverview(userId: string) {
  const { data } = await api.get(ADMIN_ENDPOINTS.users.overview(userId));
  return unwrap<AdminUserWalletOverview>(data);
}

export async function fetchAdminDepositAddresses(userId: string) {
  const { data } = await api.get(ADMIN_ENDPOINTS.users.depositAddresses(userId));
  return unwrap<AdminDepositAddress[]>(data);
}

export async function fetchAdminDeposits(params?: {
  page?: number;
  limit?: number;
  network?: string;
  status?: string;
  userId?: string | number;
  txHash?: string;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.deposits(params));
  return unwrap<{
    items: AdminDepositRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(data);
}

export async function fetchAdminUserWalletDeposits(params?: {
  page?: number;
  limit?: number;
  network?: string;
  status?: string;
  userId?: string | number;
  txHash?: string;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.userWalletDeposits(params));
  return unwrap<{
    summary: AdminDepositSummary;
    items: AdminDepositRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(data);
}

export async function fetchAdminUserWalletWithdrawals(params?: { status?: string; userId?: string; limit?: number; page?: number }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.userWalletWithdrawals(params));
  return unwrap<AdminWithdrawHistoryResponse>(data);
}

export async function fetchAdminWalletDeposits(params?: {
  page?: number;
  limit?: number;
  network?: string;
  status?: string;
  userId?: string | number;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.adminWalletDeposits(params));
  return unwrap<{
    summary: AdminSweepSummary;
    items: AdminSweepRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(data);
}

export async function fetchAdminWalletWithdrawQueue(params?: {
  page?: number;
  limit?: number;
  userId?: string;
  network?: string;
  fromDate?: string;
  toDate?: string;
  eligibleOnly?: boolean;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.adminWalletWithdrawQueue(params));
  return unwrap<AdminWithdrawQueueResponse>(data);
}

export async function fetchAdminWalletWithdrawQueueLiveBalances() {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.adminWalletWithdrawQueueLiveBalances);
  return unwrap<AdminWalletLiveBalances>(data);
}

export async function fetchAdminTreasury() {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.treasury);
  return unwrap<AdminTreasuryOverview>(data);
}

export async function triggerAdminTreasurySweep(payload?: { network?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.treasurySweep, payload ?? {});
  return unwrap<{
    runId: number | string;
    sweptCount: number;
    failedCount: number;
    items: Array<Record<string, unknown>>;
  }>(data);
}

export async function fetchAdminSweepQueue(params?: {
  page?: number;
  limit?: number;
  network?: string;
  status?: string;
  userId?: string | number;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.sweeps(params));
  return unwrap<{
    items: AdminCustodialSweepRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(data);
}

export async function fetchAdminGasFundingQueue(params?: {
  page?: number;
  limit?: number;
  network?: string;
  status?: string;
  userId?: string | number;
}) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.gasFunding(params));
  return unwrap<{
    items: AdminGasFundingRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(data);
}

export async function runEligibleSweeps(payload?: { network?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.runEligibleSweeps, payload ?? {});
  return unwrap<{
    queuedCount: number;
    processedCount: number;
    items: Array<Record<string, unknown>>;
  }>(data);
}

export async function runPendingGasFunding(payload?: { network?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.runPendingGasFunding, payload ?? {});
  return unwrap<{
    processedCount: number;
    items: Array<Record<string, unknown>>;
  }>(data);
}

export async function runSweepById(id: string | number) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.runSweep(id), {});
  return unwrap<Record<string, unknown>>(data);
}

export async function retrySweepById(id: string | number) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.retrySweep(id), {});
  return unwrap<Record<string, unknown>>(data);
}

export async function sendGasFundingById(id: string | number) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.sendGasFunding(id), {});
  return unwrap<Record<string, unknown>>(data);
}

export async function retryGasFundingById(id: string | number) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.retryGasFunding(id), {});
  return unwrap<Record<string, unknown>>(data);
}

export async function fetchAdminMarkets() {
  const { data } = await api.get(ADMIN_ENDPOINTS.markets);
  return unwrap<any[]>(data);
}

export async function fetchAdminAuditLogs(limit?: number) {
  const { data } = await api.get(ADMIN_ENDPOINTS.audit(limit ? { limit } : undefined));
  return unwrap<AdminAuditLog[]>(data);
}

export async function fetchAdminWebsocketStatus() {
  const { data } = await api.get(ADMIN_ENDPOINTS.websocketStatus);
  return unwrap<AdminWebsocketStatus>(data);
}

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const { data } = await api.get(ADMIN_ENDPOINTS.settings.get);
  return unwrap<AdminSettings>(data);
}

export async function updateAdminSettings(payload: Partial<AdminSettings>): Promise<AdminSettings> {
  const { data } = await api.put(ADMIN_ENDPOINTS.settings.update, payload);
  return unwrap<AdminSettings>(data);
}

export async function uploadAdminSettingsAsset(
  field: "siteLogoUrl" | "siteFaviconUrl",
  file: File
): Promise<{ field: "siteLogoUrl" | "siteFaviconUrl"; url: string; filename: string; mimeType: string; size: number }> {
  const formData = new FormData();
  formData.append("field", field);
  formData.append("file", file);
  const { data } = await api.post(ADMIN_ENDPOINTS.settings.upload, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return unwrap<{ field: "siteLogoUrl" | "siteFaviconUrl"; url: string; filename: string; mimeType: string; size: number }>(data);
}

export async function changeAdminPassword(payload: { currentPassword: string; newPassword: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.settings.password, payload);
  return unwrap<{ updated: boolean }>(data);
}

export async function fetchAdminSignalPackageModule(): Promise<AdminSignalPackageModule> {
  const { data } = await api.get(ADMIN_ENDPOINTS.signalPackages.get);
  return unwrap<AdminSignalPackageModule>(data);
}

export async function fetchAdminIncomeLedgerSummary(): Promise<AdminIncomeLedgerSummary> {
  const { data } = await api.get(ADMIN_ENDPOINTS.commission.incomeSummary);
  return unwrap<AdminIncomeLedgerSummary>(data);
}

export async function fetchAdminIncomeLedger(params?: {
  page?: number;
  limit?: number;
  search?: string;
  incomeType?: string;
  level?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  group?: string;
}): Promise<PaginatedResult<AdminIncomeLedgerRow>> {
  const { data } = await api.get(ADMIN_ENDPOINTS.commission.incomeLedger(params));
  return unwrap<PaginatedResult<AdminIncomeLedgerRow>>(data);
}

export async function fetchAdminIncomeLedgerUserSummary(params?: {
  page?: number;
  limit?: number;
  search?: string;
  incomeType?: string;
  level?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  group?: string;
}): Promise<PaginatedResult<AdminIncomeLedgerUserSummaryRow>> {
  const { data } = await api.get(ADMIN_ENDPOINTS.commission.incomeLedgerUserSummary(params));
  return unwrap<PaginatedResult<AdminIncomeLedgerUserSummaryRow>>(data);
}

export async function exportAdminIncomeLedger(params?: {
  search?: string;
  incomeType?: string;
  level?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  group?: string;
}) {
  const response = await api.get(ADMIN_ENDPOINTS.commission.incomeLedgerExport(params), { responseType: "blob" });
  return response.data as Blob;
}

export async function fetchAdminCommissionHistory(params?: {
  page?: number;
  limit?: number;
  search?: string;
  incomeType?: string;
  level?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  group?: string;
}): Promise<PaginatedResult<AdminIncomeLedgerRow>> {
  const { data } = await api.get(ADMIN_ENDPOINTS.commission.history(params));
  return unwrap<PaginatedResult<AdminIncomeLedgerRow>>(data);
}

export async function fetchAdminControlSettings(): Promise<AdminControlSettings> {
  const { data } = await api.get(ADMIN_ENDPOINTS.controlSettings.get);
  return unwrap<AdminControlSettings>(data);
}

export async function getLevelManagementSettings(): Promise<AdminLevelManagementSettings> {
  const { data } = await api.get(ADMIN_ENDPOINTS.levelManagement.get);
  return unwrap<AdminLevelManagementSettings>(data);
}

export async function updateLevelManagementSettings(
  payload: UpdateAdminLevelManagementSettingsPayload
): Promise<AdminLevelManagementSettings> {
  const { data } = await api.put(ADMIN_ENDPOINTS.levelManagement.update, payload);
  return unwrap<AdminLevelManagementSettings>(data);
}

export async function updateAdminControlSettings(
  payload: UpdateAdminControlSettingsPayload
): Promise<AdminControlSettings> {
  const { data } = await api.put(ADMIN_ENDPOINTS.controlSettings.update, payload);
  return unwrap<AdminControlSettings>(data);
}

export async function fetchAdminSignalHistoryDayWise(): Promise<AdminSignalHistoryDayWiseRow[]> {
  const { data } = await api.get(ADMIN_ENDPOINTS.controlSettings.signalHistoryDayWise);
  return unwrap<AdminSignalHistoryDayWiseRow[]>(data);
}

export async function fetchAdminSignalHistoryByToken(batchToken: string): Promise<AdminSignalHistoryTokenDetail> {
  const { data } = await api.get(ADMIN_ENDPOINTS.controlSettings.signalHistoryToken(batchToken));
  return unwrap<AdminSignalHistoryTokenDetail>(data);
}

export async function generateAdminTradeSlotToken(
  slotId: string | number,
  payload?: { slotDate?: string; previewOnly?: boolean }
): Promise<AdminTradeSlotBatch> {
  const { data } = await api.post(ADMIN_ENDPOINTS.controlSettings.generateTradeSlotToken(slotId), payload ?? {});
  return unwrap<AdminTradeSlotBatch>(data);
}

export async function updateAdminSignalPackageSettings(
  payload: Partial<AdminSignalPackageSettings>
): Promise<AdminSignalPackageModule> {
  const { data } = await api.put(ADMIN_ENDPOINTS.signalPackages.updateSettings, payload);
  return unwrap<AdminSignalPackageModule>(data);
}

export async function createAdminSignalPackage(payload: AdminSignalPackagePayload): Promise<AdminSignalPackage> {
  const { data } = await api.post(ADMIN_ENDPOINTS.signalPackages.create, payload);
  return unwrap<AdminSignalPackage>(data);
}

export async function updateAdminSignalPackage(
  id: string | number,
  payload: Partial<AdminSignalPackagePayload>
): Promise<AdminSignalPackage> {
  const { data } = await api.patch(ADMIN_ENDPOINTS.signalPackages.update(id), payload);
  return unwrap<AdminSignalPackage>(data);
}

export async function fetchAdminSignalAssets(params?: { status?: string; asset?: string; includeDisabled?: boolean }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.assets.list(params));
  return unwrap<AdminSignalAsset[]>(data);
}

export async function createAdminSignalAsset(payload: AdminSignalAssetPayload) {
  const { data } = await api.post(ADMIN_ENDPOINTS.assets.create, payload);
  return unwrap<AdminSignalAsset>(data);
}

export async function updateAdminSignalAsset(id: string | number, payload: Partial<AdminSignalAssetPayload>) {
  const { data } = await api.patch(ADMIN_ENDPOINTS.assets.update(id), payload);
  return unwrap<AdminSignalAsset>(data);
}

export async function fetchAdminKycRequests(params?: { page?: number; pageSize?: number; status?: string; search?: string }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.kyc.requests(params));
  return unwrap<AdminKycRequestListResponse>(data);
}

export async function fetchAdminKycSidebarSummary() {
  const { data } = await api.get(ADMIN_ENDPOINTS.kyc.summary);
  return unwrap<AdminKycSidebarSummary>(data);
}

export async function fetchAdminKycRequestDetail(id: string | number) {
  const { data } = await api.get(ADMIN_ENDPOINTS.kyc.request(id));
  return unwrap<AdminKycRequestDetail>(data);
}

export async function adminApproveKycRequest(id: string | number, payload?: { notes?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.kyc.approve(id), payload ?? {});
  return unwrap<AdminKycRequestDetail>(data);
}

export async function adminDeclineKycRequest(id: string | number, payload?: { notes?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.kyc.decline(id), payload ?? {});
  return unwrap<AdminKycRequestDetail>(data);
}

type AdminOrderQuery = {
  limit?: number;
  search?: string;
  symbol?: string;
  status?: string;
  userId?: string | number;
};

export async function fetchAdminLiveOrders(params?: AdminOrderQuery) {
  const { data } = await api.get(ADMIN_ENDPOINTS.orders.live(params));
  return unwrap<AdminOrder[]>(data);
}

export async function fetchAdminRecentOrders(params?: AdminOrderQuery) {
  const { data } = await api.get(ADMIN_ENDPOINTS.orders.recent(params));
  return unwrap<AdminOrder[]>(data);
}

export async function fetchAdminRecentTrades(params?: Omit<AdminOrderQuery, "status">) {
  const { data } = await api.get(ADMIN_ENDPOINTS.orders.trades(params));
  return unwrap<AdminTrade[]>(data);
}

export async function fetchAdminFiatDeposits(params?: { status?: string; method?: string; userId?: string | number }) {
  const { data } = await api.get(ADMIN_ENDPOINTS.wallet.fiatDeposits(params));
  const payload = unwrap(data);
  return Array.isArray(payload) ? payload.map((item) => {
    const record = item as any;
    return {
      id: record.id,
      userId: record.userId ?? record.user?.id ?? "unknown",
      user: record.user,
      method: record.method,
      wallet: record.wallet,
      amount: record.amount,
      currency: record.currency ?? "USD",
      status: record.status,
      proofUrl: record.proofUrl,
      referenceCode: record.referenceCode ?? record.reference,
      notes: record.notes,
      createdAt: record.createdAt ?? record.timestamp ?? new Date().toISOString(),
    } as AdminFiatDeposit;
  }) : [];
}

export async function adminApproveFiatDeposit(id: string | number, payload?: { notes?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.approveFiatDeposit(id), payload ?? {});
  return unwrap<AdminFiatDeposit>(data);
}

export async function adminRejectFiatDeposit(id: string | number, payload?: { notes?: string }) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.rejectFiatDeposit(id), payload ?? {});
  return unwrap<AdminFiatDeposit>(data);
}

export type AdminWalletTransferPayload = {
  from: "spot" | "futures";
  to: "spot" | "futures";
  asset: string;
  amount: number;
};

export async function adminTransferBetweenWallets(userId: string | number, payload: AdminWalletTransferPayload) {
  const { data } = await api.post(ADMIN_ENDPOINTS.wallet.transfer(userId), payload);
  return unwrap(data);
}

export type AdminStakingSummary = {
  totalValueUsd: number;
  averageApr: number;
  activeLockups: number;
  nextRewardCycle?: {
    nextAt?: string;
    secondsUntil?: number;
    intervalHours?: number;
  };
};

export type AdminStakingPoolStats = {
  activePositions?: number;
  totalLocked?: string;
  totalLockedUsd?: number;
};

export type AdminStakingPackage = {
  id: number;
  label: string;
  asset: string;
  aprPercent: number;
  lockDays: number;
  minAmount?: string;
  maxAmount?: string | null;
  isFeatured?: boolean;
  status?: string;
  sortOrder?: number;
  description?: string;
  stats?: AdminStakingPoolStats;
};

export type AdminStakingOverview = {
  summary: AdminStakingSummary;
  pools: AdminStakingPackage[];
  recentPositions: Array<{
    id: number;
    userId: number;
    packageId: number;
    asset: string;
    amount: string;
    status: string;
    aprPercent: number;
    lockDays: number;
    autoCompound: boolean;
    stakedAt: string;
    unlockAt?: string | null;
    rewardsAccrued?: string;
    estimatedRewards?: string;
  }>;
};

export type AdminStakingPosition = {
  id: number;
  user: { id: number | string; email: string };
  package: { id: number; label: string; asset: string };
  asset: string;
  amount: string;
  aprPercent: number;
  lockDays: number;
  status: string;
  stakedAt: string;
  unlockAt?: string | null;
  matured?: boolean;
  estimatedRewards?: string;
  rewardsPaid?: string;
  autoCompound?: boolean;
};

export type AdminStakingPayout = {
  amount: string;
  asset: string;
  executed: boolean;
};

export type AdminStakingPositionPayoutResponse = {
  position: AdminStakingPosition;
  payout: AdminStakingPayout;
};

export type CreateAdminStakingPackagePayload = {
  label: string;
  asset: string;
  aprPercent: number;
  lockDays: number;
  minAmount?: string;
  maxAmount?: string | null;
  isFeatured?: boolean;
  status?: string;
  sortOrder?: number;
  description?: string;
};

export type UpdateAdminStakingPackagePayload = Partial<CreateAdminStakingPackagePayload>;

export function fetchAdminStakingOverview() {
  return api.get(ADMIN_ENDPOINTS.staking.overview).then((res) => unwrap<AdminStakingOverview>(res.data));
}

export function fetchAdminStakingPackages(params?: { status?: string }) {
  return api
    .get(ADMIN_ENDPOINTS.staking.packages(params))
    .then((res) => unwrap<AdminStakingPackage[]>(res.data));
}

export function createAdminStakingPackage(payload: CreateAdminStakingPackagePayload) {
  return api
    .post(ADMIN_ENDPOINTS.staking.packages(), payload)
    .then((res) => unwrap<AdminStakingPackage>(res.data));
}

export function updateAdminStakingPackage(id: number | string, payload: UpdateAdminStakingPackagePayload) {
  return api
    .patch(ADMIN_ENDPOINTS.staking.package(id), payload)
    .then((res) => unwrap<AdminStakingPackage>(res.data));
}

export function fetchAdminStakingPositions(params?: {
  status?: string;
  userId?: string | number;
  packageId?: string | number;
}) {
  return api
    .get(ADMIN_ENDPOINTS.staking.positions(params))
    .then((res) => unwrap<AdminStakingPosition[]>(res.data));
}

export function adminPayoutPosition(positionId: number | string) {
  return api
    .post(ADMIN_ENDPOINTS.staking.positionPayout(positionId))
    .then((res) => unwrap<AdminStakingPositionPayoutResponse>(res.data));
}

export type AdminStakingEarningsTopUser = {
  userId: number | string;
  email: string;
  fullName?: string | null;
  positions: number;
  totalLockedUsd: number;
  realizedRewardsUsd: number;
  pendingRewardsUsd: number;
};

export type AdminStakingEarningsFilters = {
  rangeDays: number;
  asset?: string | null;
  userId?: string | number | null;
  status?: string | null;
};

export type AdminStakingEarningsReport = StakingEarningsReport & {
  summary: StakingEarningsReport["summary"] & { participants?: number };
  topUsers: AdminStakingEarningsTopUser[];
  filters: AdminStakingEarningsFilters;
};

export type AdminStakingRunPayoutsResponse = {
  checked: number;
  payouts: Array<{ positionId: number | string; userId: number | string; asset: string; amount: string }>;
};

export function fetchAdminStakingEarnings(params?: {
  rangeDays?: number;
  asset?: string;
  userId?: string | number;
  status?: string;
}) {
  return api
    .get(ADMIN_ENDPOINTS.staking.earnings(params))
    .then((res) => unwrap<AdminStakingEarningsReport>(res.data));
}

export function adminRunStakingPayouts(limit?: number) {
  const payload = typeof limit === "number" ? { limit } : {};
  return api
    .post(ADMIN_ENDPOINTS.staking.runPayouts, payload)
    .then((res) => unwrap<AdminStakingRunPayoutsResponse>(res.data));
}

export function fetchAdminSipPlans() {
  return api
    .get(ADMIN_ENDPOINTS.sip.plans.list())
    .then((res) => unwrap<AdminSipPlan[]>(res.data));
}

export function createAdminSipPlan(payload: AdminSipPlanPayload) {
  return api
    .post(ADMIN_ENDPOINTS.sip.plans.create(), payload)
    .then((res) => unwrap<AdminSipPlan>(res.data));
}

export function updateAdminSipPlan(id: number | string, payload: Partial<AdminSipPlanPayload>) {
  return api
    .patch(ADMIN_ENDPOINTS.sip.plans.update(id), payload)
    .then((res) => unwrap<AdminSipPlan>(res.data));
}

export function fetchAdminSipSubscriptions(params?: {
  planId?: string | number;
  status?: string;
  userId?: string | number;
  limit?: number;
}) {
  return api
    .get(ADMIN_ENDPOINTS.sip.subscriptions(params))
    .then((res) => unwrap<AdminSipSubscription[]>(res.data));
}

export function fetchAdminSipOrders(params?: {
  planId?: string | number;
  subscriptionId?: string | number;
  status?: string;
  limit?: number;
}) {
  return api
    .get(ADMIN_ENDPOINTS.sip.orders(params))
    .then((res) => unwrap<AdminSipOrder[]>(res.data));
}
