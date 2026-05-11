export type EligiblePackage = {
  name: string;
  minAmount: number;
  maxAmount: number | null;
  signalsPerDay: number;
  requiredLevel: number;
};

export type ActiveSlot = {
  id?: string | number;
  key: string;
  label: string;
  start: string;
  end: string;
  slotTime: string;
  startMinutes: number;
  endMinutes: number;
};

export type TradeCalculationResult = {
  investmentAmount: number;
  profitAmount: number;
  totalEarned: number;
  newBalance: number;
};

export type TradeCalculationRules = {
  investmentPercent: number;
  profitPercent: number;
};

export type TradeEligibilityResult =
  | {
      ok: true;
      activeSlot: ActiveSlot;
      eligiblePackage: EligiblePackage;
      remainingSignals: number;
    }
  | {
      ok: false;
      message: string;
      code:
        | "MINIMUM_BALANCE"
        | "LEVEL_REQUIRED"
        | "DAILY_LIMIT"
        | "SLOT_EXPIRED"
        | "TOKEN_REQUIRED";
    };

const SLOT_CONFIG: ActiveSlot[] = [
  { key: "9", label: "09:00 Slot", start: "09:00", end: "09:10", slotTime: "09:00:00", startMinutes: 9 * 60, endMinutes: 9 * 60 + 10 },
  { key: "12", label: "12:00 Slot", start: "12:00", end: "12:10", slotTime: "12:00:00", startMinutes: 12 * 60, endMinutes: 12 * 60 + 10 },
  { key: "3", label: "15:00 Slot", start: "15:00", end: "15:10", slotTime: "15:00:00", startMinutes: 15 * 60, endMinutes: 15 * 60 + 10 },
  { key: "6", label: "18:00 Slot", start: "18:00", end: "18:10", slotTime: "18:00:00", startMinutes: 18 * 60, endMinutes: 18 * 60 + 10 },
];

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100000000) / 100000000;

export function detectEligiblePackage(balance: number, userLevel = 0): {
  package: EligiblePackage | null;
  allowedSignalsPerDay: number;
  eligible: boolean;
  levelMet: boolean;
  message?: string;
} {
  if (!Number.isFinite(balance) || balance < 100) {
    return {
      package: null,
      allowedSignalsPerDay: 0,
      eligible: false,
      levelMet: true,
      message: "Minimum 100 USDT required to activate trade.",
    };
  }

  const packageMatch: EligiblePackage =
    balance <= 299
      ? { name: "Package 1", minAmount: 100, maxAmount: 299, signalsPerDay: 1, requiredLevel: 0 }
      : balance <= 4999
      ? { name: "Package 2", minAmount: 300, maxAmount: 4999, signalsPerDay: 2, requiredLevel: 0 }
      : balance <= 24999
      ? { name: "Package 3", minAmount: 5000, maxAmount: 24999, signalsPerDay: 3, requiredLevel: 1 }
      : { name: "Package 4", minAmount: 25000, maxAmount: null, signalsPerDay: 4, requiredLevel: 2 };

  if (userLevel < packageMatch.requiredLevel) {
    return {
      package: packageMatch,
      allowedSignalsPerDay: packageMatch.signalsPerDay,
      eligible: false,
      levelMet: false,
      message: `Required level not met for ${packageMatch.name}.`,
    };
  }

  return {
    package: packageMatch,
    allowedSignalsPerDay: packageMatch.signalsPerDay,
    eligible: true,
    levelMet: true,
  };
}

export function getActiveSlot(now = new Date(), slots: ActiveSlot[] = SLOT_CONFIG): ActiveSlot | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return slots.find((slot) => minutes >= slot.startMinutes && minutes <= slot.endMinutes) ?? null;
}

export function calculateTradeResult(
  currentBalance: number,
  rules: TradeCalculationRules = { investmentPercent: 1, profitPercent: 0.65 }
): TradeCalculationResult {
  const investmentAmount = roundCurrency(currentBalance * (rules.investmentPercent / 100));
  const profitAmount = roundCurrency(investmentAmount * (rules.profitPercent / 100));
  const totalEarned = roundCurrency(investmentAmount + profitAmount);
  const newBalance = roundCurrency(currentBalance + profitAmount);

  return {
    investmentAmount,
    profitAmount,
    totalEarned,
    newBalance,
  };
}

export function validateTradeEligibility(params: {
  currentBalance: number;
  userLevel?: number;
  todayUsedSignals: number;
  signalCodeInput: string;
  now?: Date;
  availableSlots?: ActiveSlot[];
}): TradeEligibilityResult {
  const packageState = detectEligiblePackage(params.currentBalance, params.userLevel ?? 0);
  if (!packageState.eligible || !packageState.package) {
    if (packageState.levelMet === false) {
      return { ok: false, code: "LEVEL_REQUIRED", message: "You are not allowed for the current trade." };
    }
    return { ok: false, code: "MINIMUM_BALANCE", message: "Minimum 100 USDT required to activate trade." };
  }

  if ((params.signalCodeInput ?? "").trim().length === 0) {
    return { ok: false, code: "TOKEN_REQUIRED", message: "Invalid signal code." };
  }

  if (params.todayUsedSignals >= packageState.allowedSignalsPerDay) {
    return { ok: false, code: "DAILY_LIMIT", message: "You are not allowed for the current trade." };
  }

  const activeSlot = getActiveSlot(params.now ?? new Date(), params.availableSlots ?? SLOT_CONFIG);
  if (!activeSlot) {
    return { ok: false, code: "SLOT_EXPIRED", message: "Signal validity time has expired." };
  }

  return {
    ok: true,
    activeSlot,
    eligiblePackage: packageState.package,
    remainingSignals: Math.max(packageState.allowedSignalsPerDay - params.todayUsedSignals, 0),
  };
}

export function getSignalSlots() {
  return SLOT_CONFIG;
}
