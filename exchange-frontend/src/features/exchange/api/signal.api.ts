import api from "../../../app/axios";
import { SIGNAL_ENDPOINTS } from "../../../app/apiRoutes";
import { detectEligiblePackage, type ActiveSlot, type EligiblePackage } from "../signal/signal.helpers";

type ApiEnvelope<T> = { data: T };
type UnknownRecord = Record<string, unknown>;

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const ensureRecord = (value: unknown): UnknownRecord => (value && typeof value === "object" ? (value as UnknownRecord) : {});
const ensureArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? Number(parsed) : fallback;
};
const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? Number(parsed) : undefined;
};
const toMinutes = (value: string) => {
  const [hours, minutes] = String(value || "00:00").split(":").map((item) => Number(item));
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
};

export type SignalAuditJson = {
  symbol?: string;
  mode?: string;
  side?: string;
  previous_balance: number;
  current_wallet_balance: number;
  wallet_balance_before?: number;
  wallet_balance_after_buy?: number;
  wallet_balance_before_sell?: number;
  wallet_balance_after_sell?: number;
  investment_percent: number;
  profit_percent: number;
  investment_amount: number;
  principal_amount?: number;
  profit_amount: number;
  total_earned: number;
  total_return_usdt?: number;
  buy_price?: number;
  sell_price?: number;
  executed_qty?: number;
  expires_at?: string;
  buy_created_at?: string;
  sell_created_at?: string;
  new_balance: number;
  signal_token: string;
  slot_key: string;
  slot_time: string;
  applied_at: string;
  daily_trade_used_before: number;
  daily_trade_used_after: number;
  eligible_package: {
    name: string;
    min_amount: number;
    max_amount: number | null;
    signals_per_day: number;
  };
};

export type SignalWalletSummary = {
  currentBalance: number;
  mainWalletBalance: number;
  depositTotal: number;
  signalIncomeTotal: number;
  mlmIncomeTotal: number;
  totalEarnings: number;
  availableBalance: number;
  userLevel: number;
  todayUsedSignals: number;
  allowedSignalsToday: number;
  remainingSignals: number;
  eligiblePackage: EligiblePackage | null;
  activeSlot: ActiveSlot | null;
  availableSlots: ActiveSlot[];
  investmentPerTradePercent: number;
  dailyPercentPerTrade: number;
  signalValidityMinutes: number;
};

export type SignalHistoryRow = {
  id: string;
  appliedAt: string;
  buyCreatedAt?: string;
  sellCreatedAt?: string | null;
  slotKey: string;
  slotLabel: string;
  symbol?: string;
  mode?: string;
  signalToken: string;
  previousBalance: number;
  walletBalanceBefore?: number;
  walletBalanceAfterBuy?: number;
  walletBalanceBeforeSell?: number;
  walletBalanceAfterSell?: number;
  investmentAmount: number;
  principalAmount?: number;
  buyPrice?: number;
  sellPrice?: number;
  executedQty?: number;
  profitAmount: number;
  totalEarned: number;
  totalReturnUsdt?: number;
  newBalance: number;
  tradeStatus?: string;
  orderStatus?: string;
  sellTrigger?: string | null;
  expiresAt?: string | null;
  status: string;
  auditJson?: SignalAuditJson | null;
};

export type DepositHistoryRow = {
  id: string | number;
  date: string;
  depositToken: string;
  network: string;
  method: string;
  depositAmount: number;
  previousDepositTotal: number;
  newDepositTotal: number;
  status: string;
};

export type MlmIncomeHistoryRow = {
  id: string | number;
  date: string;
  incomeType: string;
  sourceUser?: string | null;
  previousBalance: number;
  mlmEarned: number;
  newBalance: number;
  status: string;
  remark?: string | null;
};

export type WalletLedgerRow = {
  id: string | number;
  date: string;
  type: string;
  sourceType: string;
  referenceId?: string | null;
  previousBalance: number;
  credit: number;
  debit: number;
  newBalance: number;
  status: string;
  remark?: string | null;
};

export type ValidateSignalRequest = {
  token: string;
  slot_key: string;
};

export type ApplySignalRequest = {
  token: string;
  slot_key: string;
  audit_json: SignalAuditJson;
};

const buildPackage = (raw: UnknownRecord, fallbackBalance: number, level: number): EligiblePackage | null => {
  if (Object.keys(raw).length === 0) {
    return detectEligiblePackage(fallbackBalance, level).package;
  }
  return {
    name: String(raw.name ?? "Package"),
    minAmount: toNumber(raw.min_amount ?? raw.minAmount),
    maxAmount:
      raw.max_amount === null || raw.maxAmount === null
        ? null
        : toNumber(raw.max_amount ?? raw.maxAmount, null as unknown as number),
    signalsPerDay: toNumber(raw.signals_per_day ?? raw.signalsPerDay),
    requiredLevel: toNumber(raw.required_level ?? raw.requiredLevel),
  };
};

const mapWalletSummary = (value: unknown): SignalWalletSummary => {
  const raw = ensureRecord(value);
  const currentBalance = toNumber(
    raw.currentBalance ?? raw.current_balance ?? raw.current_wallet_balance ?? raw.walletBalance ?? raw.balance
  );
  const mainWalletBalance = toNumber(raw.mainWalletBalance ?? raw.main_wallet_balance ?? currentBalance);
  const depositTotal = toNumber(raw.depositTotal ?? raw.deposit_total ?? raw.totalDeposit ?? currentBalance);
  const signalIncomeTotal = toNumber(raw.signalIncomeTotal ?? raw.signal_income_total);
  const mlmIncomeTotal = toNumber(raw.mlmIncomeTotal ?? raw.mlm_income_total);
  const totalEarnings = toNumber(raw.totalEarnings ?? raw.total_earnings ?? signalIncomeTotal + mlmIncomeTotal);
  const availableBalance = toNumber(raw.availableBalance ?? raw.available_balance ?? mainWalletBalance);
  const userLevel = toNumber(raw.userLevel ?? raw.user_level ?? raw.level);
  const todayUsedSignals = toNumber(raw.todayUsedSignals ?? raw.today_used_signals ?? raw.todayTradeCount ?? raw.today_trade_count);
  const derivedPackageState = detectEligiblePackage(currentBalance, userLevel);
  const eligiblePackage = buildPackage(
    ensureRecord(raw.eligiblePackage ?? raw.eligible_package ?? raw.currentPackage ?? raw.current_package),
    currentBalance,
    userLevel
  );
  const allowedSignalsToday = toNumber(
    raw.allowedSignalsToday ?? raw.allowed_signals_today ?? eligiblePackage?.signalsPerDay ?? derivedPackageState.allowedSignalsPerDay
  );
  const remainingSignals = Math.max(
    toNumber(raw.remainingSignals ?? raw.remaining_signals ?? allowedSignalsToday - todayUsedSignals),
    0
  );
  return {
    currentBalance,
    mainWalletBalance,
    depositTotal,
    signalIncomeTotal,
    mlmIncomeTotal,
    totalEarnings,
    availableBalance,
    userLevel,
    todayUsedSignals,
    allowedSignalsToday,
    remainingSignals,
    eligiblePackage,
    activeSlot: (() => {
      const slot = ensureRecord(raw.active_slot ?? raw.activeSlot);
      if (Object.keys(slot).length === 0) return null;
      const start = String(slot.start ?? "").slice(0, 5);
      const end = String(slot.end ?? "").slice(0, 5);
      return {
        id: typeof slot.id === "string" || typeof slot.id === "number" ? slot.id : undefined,
        key: String(slot.key ?? ""),
        label: String(slot.label ?? slot.start ?? "Active Slot"),
        start,
        end,
        slotTime: String(slot.slot_time ?? slot.slotTime ?? ""),
        startMinutes: toMinutes(start),
        endMinutes: toMinutes(end),
      };
    })(),
    availableSlots: ensureArray(raw.available_slots ?? raw.availableSlots).map((item) => {
      const slot = ensureRecord(item);
      const start = String(slot.start ?? "").slice(0, 5);
      const end = String(slot.end ?? "").slice(0, 5);
      return {
        id: typeof slot.id === "string" || typeof slot.id === "number" ? slot.id : undefined,
        key: String(slot.key ?? ""),
        label: String(slot.label ?? slot.start ?? "Slot"),
        start,
        end,
        slotTime: String(slot.slot_time ?? slot.slotTime ?? ""),
        startMinutes: toMinutes(start),
        endMinutes: toMinutes(end),
      };
    }),
    investmentPerTradePercent: toNumber(
      raw.investmentPerTradePercent ??
        raw.investment_per_trade_percent ??
        raw.globalRulesInvestmentPerTradePercent ??
        1,
      1
    ),
    dailyPercentPerTrade: toNumber(
      raw.dailyPercentPerTrade ??
        raw.daily_percent_per_trade ??
        raw.profitPercent ??
        raw.profit_percent ??
        0.65,
      0.65
    ),
    signalValidityMinutes: toNumber(raw.signal_validity_minutes ?? raw.signalValidityMinutes, 10),
  };
};

const mapHistoryRow = (value: unknown, index: number): SignalHistoryRow => {
  const raw = ensureRecord(value);
  const appliedAt = String(raw.appliedAt ?? raw.applied_at ?? raw.createdAt ?? raw.created_at ?? new Date().toISOString());
  const slotKey = String(raw.slotKey ?? raw.slot_key ?? raw.slot ?? "");
  const auditJson = ensureRecord(raw.auditJson ?? raw.audit_json);
  const previousBalance = toNumber(
    raw.previousBalance ??
      raw.previous_balance ??
      raw.currentWalletBalance ??
      raw.current_wallet_balance ??
      auditJson.current_wallet_balance ??
      auditJson.previous_balance
  );
  const investmentAmount = toNumber(raw.investmentAmount ?? raw.investment_amount ?? auditJson.investment_amount);
  const profitAmount = toNumber(raw.profitAmount ?? raw.profit_amount ?? auditJson.profit_amount);
  const totalEarned = toNumber(raw.totalEarned ?? raw.total_earned ?? auditJson.total_earned);
  const newBalance = toNumber(raw.newBalance ?? raw.new_balance ?? auditJson.new_balance);

  return {
    id: String(raw.id ?? raw.signalLogId ?? `${appliedAt}-${slotKey}-${index}`),
    appliedAt,
    buyCreatedAt: String(raw.buyCreatedAt ?? raw.buy_created_at ?? appliedAt),
    sellCreatedAt: raw.sellCreatedAt ?? raw.sell_created_at ? String(raw.sellCreatedAt ?? raw.sell_created_at) : null,
    slotKey,
    slotLabel: slotKey ? `${slotKey}:00` : "--",
    symbol: raw.symbol ? String(raw.symbol) : undefined,
    mode: raw.mode ? String(raw.mode) : undefined,
    signalToken: String(raw.signalToken ?? raw.signal_token ?? raw.token ?? auditJson.signal_token ?? "--"),
    previousBalance,
    walletBalanceBefore: toNumber(raw.walletBalanceBefore ?? raw.wallet_balance_before ?? auditJson.wallet_balance_before ?? previousBalance),
    walletBalanceAfterBuy: toOptionalNumber(raw.walletBalanceAfterBuy ?? raw.wallet_balance_after_buy ?? auditJson.wallet_balance_after_buy),
    walletBalanceBeforeSell: toOptionalNumber(raw.walletBalanceBeforeSell ?? raw.wallet_balance_before_sell ?? auditJson.wallet_balance_before_sell),
    walletBalanceAfterSell: toOptionalNumber(raw.walletBalanceAfterSell ?? raw.wallet_balance_after_sell ?? auditJson.wallet_balance_after_sell),
    investmentAmount,
    principalAmount: toNumber(raw.principalAmount ?? raw.principal_amount ?? auditJson.principal_amount ?? investmentAmount),
    buyPrice: toOptionalNumber(raw.buyPrice ?? raw.buy_price ?? auditJson.buy_price),
    sellPrice: toOptionalNumber(raw.sellPrice ?? raw.sell_price ?? auditJson.sell_price),
    executedQty: toOptionalNumber(raw.executedQty ?? raw.executed_qty ?? auditJson.executed_qty),
    profitAmount,
    totalEarned,
    totalReturnUsdt: toOptionalNumber(raw.totalReturnUsdt ?? raw.total_return_usdt ?? auditJson.total_return_usdt),
    newBalance,
    tradeStatus: String(raw.tradeStatus ?? raw.trade_status ?? "OPEN"),
    orderStatus: String(raw.orderStatus ?? raw.order_status ?? "FILLED"),
    sellTrigger: raw.sellTrigger ?? raw.sell_trigger ? String(raw.sellTrigger ?? raw.sell_trigger) : null,
    expiresAt: raw.expiresAt ?? raw.expires_at ? String(raw.expiresAt ?? raw.expires_at) : null,
    status: String(raw.status ?? "Success"),
    auditJson: Object.keys(auditJson).length ? (auditJson as unknown as SignalAuditJson) : null,
  };
};

export async function fetchSignalWalletSummary(): Promise<SignalWalletSummary> {
  const response = await api.get(SIGNAL_ENDPOINTS.walletSummary);
  return mapWalletSummary(unwrap<unknown>(response.data));
}

export async function validateSignalToken(payload: ValidateSignalRequest): Promise<unknown> {
  const response = await api.post(SIGNAL_ENDPOINTS.validate, payload);
  return unwrap<unknown>(response.data);
}

export async function applySignal(payload: ApplySignalRequest): Promise<unknown> {
  const response = await api.post(SIGNAL_ENDPOINTS.apply, payload);
  return unwrap<unknown>(response.data);
}

export async function fetchSignalHistory(): Promise<SignalHistoryRow[]> {
  const response = await api.get(SIGNAL_ENDPOINTS.history);
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map((item, index) => mapHistoryRow(item, index));
}

export async function fetchDepositHistory(): Promise<DepositHistoryRow[]> {
  const response = await api.get("/api/user/wallet-history/deposits");
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map((item) => {
    const raw = ensureRecord(item);
    return {
      id: String(raw.id ?? ""),
      date: String(raw.date ?? raw.createdAt ?? ""),
      depositToken: String(raw.depositToken ?? raw.hash ?? ""),
      network: String(raw.network ?? ""),
      method: String(raw.method ?? raw.type ?? ""),
      depositAmount: toNumber(raw.depositAmount ?? raw.amount),
      previousDepositTotal: toNumber(raw.previousDepositTotal),
      newDepositTotal: toNumber(raw.newDepositTotal),
      status: String(raw.status ?? ""),
    };
  });
}

export async function fetchMlmIncomeHistory(): Promise<MlmIncomeHistoryRow[]> {
  const response = await api.get("/api/user/wallet-history/mlm");
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map((item) => {
    const raw = ensureRecord(item);
    return {
      id: String(raw.id ?? ""),
      date: String(raw.date ?? raw.createdAt ?? ""),
      incomeType: String(raw.incomeType ?? raw.income_type ?? ""),
      sourceUser: raw.sourceUser ? String(raw.sourceUser) : null,
      previousBalance: toNumber(raw.previousBalance ?? raw.previous_balance),
      mlmEarned: toNumber(raw.mlmEarned ?? raw.amount),
      newBalance: toNumber(raw.newBalance ?? raw.new_balance),
      status: String(raw.status ?? ""),
      remark: raw.remark ? String(raw.remark) : null,
    };
  });
}

export async function fetchWalletLedger(): Promise<WalletLedgerRow[]> {
  const response = await api.get("/api/user/wallet-history/ledger");
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map((item) => {
    const raw = ensureRecord(item);
    return {
      id: String(raw.id ?? ""),
      date: String(raw.date ?? raw.createdAt ?? ""),
      type: String(raw.type ?? ""),
      sourceType: String(raw.sourceType ?? raw.source_type ?? ""),
      referenceId: raw.referenceId ? String(raw.referenceId) : null,
      previousBalance: toNumber(raw.previousBalance ?? raw.previous_balance),
      credit: toNumber(raw.credit),
      debit: toNumber(raw.debit),
      newBalance: toNumber(raw.newBalance ?? raw.new_balance),
      status: String(raw.status ?? ""),
      remark: raw.remark ? String(raw.remark) : null,
    };
  });
}
