export type FuturesContract = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  lotSize: number;
  maxLeverage: number;
  maintenanceMarginPct: number;
};

export type FuturesSide = "LONG" | "SHORT";

export type FuturesAutoCloseTrigger = "STOP_LOSS" | "TAKE_PROFIT";

export type FuturesPosition = {
  symbol: string;
  side: FuturesSide;
  size: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  timestamp: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

export type FuturesTrade = {
  id: string;
  symbol: string;
  side: FuturesSide;
  size: number;
  price: number;
  leverage: number;
  realizedPnl: number;
  timestamp: number;
  status: "OPENED" | "ADJUSTED" | "CLOSED";
  trigger?: FuturesAutoCloseTrigger;
};

export type FuturesPricePoint = {
  time: number;
  price: number;
};

export type FuturesAccount = {
  balance: number;
  availableMargin: number;
  marginUsed: number;
  unrealizedPnl: number;
  realizedPnl: number;
  equity: number;
};

type Listener = () => void;

const DEFAULT_CONTRACTS: FuturesContract[] = [
  {
    symbol: "BTCUSDT-PERP",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tickSize: 0.5,
    lotSize: 0.001,
    maxLeverage: 50,
    maintenanceMarginPct: 0.5,
  },
  {
    symbol: "ETHUSDT-PERP",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    tickSize: 0.1,
    lotSize: 0.01,
    maxLeverage: 40,
    maintenanceMarginPct: 0.6,
  },
  {
    symbol: "SOLUSDT-PERP",
    baseAsset: "SOL",
    quoteAsset: "USDT",
    tickSize: 0.01,
    lotSize: 0.1,
    maxLeverage: 30,
    maintenanceMarginPct: 0.8,
  },
];

export class FuturesEngine {
  private contracts: FuturesContract[];
  private markPrices: Record<string, number> = {};
  private fundingRates: Record<string, number> = {};
  private positions: Record<string, FuturesPosition | undefined> = {};
  private trades: FuturesTrade[] = [];
  private priceHistory: Record<string, FuturesPricePoint[]> = {};
  private listeners: Set<Listener> = new Set();
  private timer?: number;
  private lastUpdatedAt = Date.now();

  private static HISTORY_LIMIT = 360;

  private account: FuturesAccount = {
    balance: 10000,
    availableMargin: 10000,
    marginUsed: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    equity: 10000,
  };

  constructor(contracts: FuturesContract[] = DEFAULT_CONTRACTS) {
    this.contracts = contracts;
    contracts.forEach((contract) => {
      const basePrice = this.seedPrice(contract.baseAsset);
      this.markPrices[contract.symbol] = basePrice;
      this.fundingRates[contract.symbol] = this.randomFundingRate();
      this.priceHistory[contract.symbol] = [
        { time: Date.now(), price: basePrice },
      ];
    });
  }

  start() {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      this.updatePrices();
      this.updateFunding();
      this.revalueAccount();
      this.emit();
    }, 1000);
  }

  stop() {
    if (this.timer) {
      window.clearInterval(this.timer);
    }
    this.timer = undefined;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getContracts() {
    return this.contracts.slice();
  }

  getMarkPrice(symbol: string) {
    return this.markPrices[symbol] ?? 0;
  }

  getFundingRate(symbol: string) {
    return this.fundingRates[symbol] ?? 0;
  }

  getPositions() {
    return { ...this.positions };
  }

  getTrades() {
    return this.trades.slice();
  }

  getHistory(symbol: string, points = FuturesEngine.HISTORY_LIMIT) {
    const history = this.priceHistory[symbol] ?? [];
    const start = Math.max(0, history.length - points);
    return history.slice(start);
  }

  getLastUpdatedAt() {
    return this.lastUpdatedAt;
  }

  getAccount(): FuturesAccount {
    return { ...this.account };
  }

  setPositionTriggers(
    symbol: string,
    {
      stopLoss,
      takeProfit,
    }: { stopLoss?: number | null; takeProfit?: number | null }
  ) {
    const existing = this.positions[symbol];
    if (!existing) throw new Error("No open position to update");

    const nextStop =
      typeof stopLoss === "number" && Number.isFinite(stopLoss) && stopLoss > 0
        ? +stopLoss.toFixed(4)
        : null;
    const nextTake =
      typeof takeProfit === "number" && Number.isFinite(takeProfit) && takeProfit > 0
        ? +takeProfit.toFixed(4)
        : null;

    this.positions[symbol] = {
      ...existing,
      stopLoss: nextStop,
      takeProfit: nextTake,
    };
    this.emit();
    this.evaluateAutoCloses();
  }

  openPosition({
    symbol,
    side,
    size,
    leverage,
    stopLoss,
    takeProfit,
  }: {
    symbol: string;
    side: FuturesSide;
    size: number;
    leverage: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
  }) {
    const contract = this.contracts.find((c) => c.symbol === symbol);
    if (!contract) throw new Error("Unknown contract");
    if (size <= 0) throw new Error("Size must be positive");
    if (leverage <= 0 || leverage > contract.maxLeverage) {
      throw new Error("Invalid leverage");
    }

    const price = this.getMarkPrice(symbol);
    const notional = price * size;
    const marginRequired = notional / leverage;
    if (marginRequired > this.account.availableMargin) {
      throw new Error("Insufficient margin");
    }

    const existing = this.positions[symbol];
    let tradeStatus: FuturesTrade["status"] = "OPENED";
    let realizedPnl = 0;

    const normalizedStopLoss =
      typeof stopLoss === "number" && Number.isFinite(stopLoss) && stopLoss > 0
        ? +stopLoss.toFixed(4)
        : null;
    const normalizedTakeProfit =
      typeof takeProfit === "number" && Number.isFinite(takeProfit) && takeProfit > 0
        ? +takeProfit.toFixed(4)
        : null;

    if (existing && existing.size > 0) {
      if (existing.side === side) {
        const totalSize = existing.size + size;
        const newEntry =
          (existing.entryPrice * existing.size + price * size) / totalSize;
        const newMargin = existing.margin + marginRequired;

        this.positions[symbol] = {
          symbol,
          side,
          size: totalSize,
          entryPrice: newEntry,
          leverage,
          margin: newMargin,
          timestamp: Date.now(),
          stopLoss: normalizedStopLoss ?? existing.stopLoss ?? null,
          takeProfit: normalizedTakeProfit ?? existing.takeProfit ?? null,
        };
        this.account.marginUsed += marginRequired;
        this.account.availableMargin -= marginRequired;
        tradeStatus = "ADJUSTED";
      } else {
        const closingSize = Math.min(existing.size, size);
        const pnlPerUnit =
          existing.side === "LONG"
            ? price - existing.entryPrice
            : existing.entryPrice - price;
        realizedPnl = pnlPerUnit * closingSize;
        const remainingSize = existing.size - closingSize;
        this.account.balance += realizedPnl;
        this.account.realizedPnl += realizedPnl;
        this.account.marginUsed -= existing.margin * (closingSize / existing.size);
        this.account.availableMargin += existing.margin * (closingSize / existing.size);
        if (remainingSize > 0) {
          this.positions[symbol] = {
            ...existing,
            size: remainingSize,
            margin: existing.margin * (remainingSize / existing.size),
          };
        } else {
          this.positions[symbol] = undefined;
        }
        if (size > closingSize) {
          const residualSize = size - closingSize;
          const residualMargin = (price * residualSize) / leverage;
          if (residualMargin > this.account.availableMargin) {
            throw new Error("Insufficient margin for flip position");
          }
          this.positions[symbol] = {
            symbol,
            side,
            size: residualSize,
            entryPrice: price,
            leverage,
            margin: residualMargin,
            timestamp: Date.now(),
            stopLoss: normalizedStopLoss,
            takeProfit: normalizedTakeProfit,
          };
          this.account.marginUsed += residualMargin;
          this.account.availableMargin -= residualMargin;
        }
        tradeStatus = remainingSize > 0 ? "ADJUSTED" : "CLOSED";
      }
    } else {
      this.positions[symbol] = {
        symbol,
        side,
        size,
        entryPrice: price,
        leverage,
        margin: marginRequired,
        timestamp: Date.now(),
        stopLoss: normalizedStopLoss,
        takeProfit: normalizedTakeProfit,
      };
      this.account.marginUsed += marginRequired;
      this.account.availableMargin -= marginRequired;
    }

    this.recordTrade({
      id: Math.random().toString(36).slice(2),
      symbol,
      side,
      size,
      price,
      leverage,
      realizedPnl,
      timestamp: Date.now(),
      status: tradeStatus,
      trigger: undefined,
    });

    this.revalueAccount();
    this.normalizeAccount();
    this.emit();
  }

  closePosition(symbol: string) {
    const existing = this.positions[symbol];
    if (!existing || existing.size === 0) return;
    const price = this.getMarkPrice(symbol);
    const pnlPerUnit =
      existing.side === "LONG"
        ? price - existing.entryPrice
        : existing.entryPrice - price;
    const realizedPnl = pnlPerUnit * existing.size;

    this.account.balance += realizedPnl;
    this.account.realizedPnl += realizedPnl;
    this.account.marginUsed -= existing.margin;
    this.account.availableMargin += existing.margin;
    this.positions[symbol] = undefined;

    this.recordTrade({
      id: Math.random().toString(36).slice(2),
      symbol,
      side: existing.side,
      size: existing.size,
      price,
      leverage: existing.leverage,
      realizedPnl,
      timestamp: Date.now(),
      status: "CLOSED",
      trigger: undefined,
    });

    this.revalueAccount();
    this.normalizeAccount();
    this.emit();
  }

  private updatePrices() {
    this.contracts.forEach((contract) => {
      const prev = this.markPrices[contract.symbol] ?? this.seedPrice(contract.baseAsset);
      const drift = prev * 0.001 * (Math.random() - 0.5);
      const shock = prev * 0.002 * (Math.random() - 0.5);
      const next = Math.max(contract.tickSize, prev + drift + shock);
      const rounded = this.roundToTick(next, contract.tickSize);
      this.markPrices[contract.symbol] = rounded;
      this.recordPrice(contract.symbol, rounded);
    });
    this.lastUpdatedAt = Date.now();
    this.evaluateAutoCloses();
  }

  private updateFunding() {
    this.contracts.forEach((contract) => {
      const current = this.fundingRates[contract.symbol] ?? 0;
      const drift = (Math.random() - 0.5) * 0.0005;
      const updated = current + drift;
      const clamped = Math.max(-0.01, Math.min(0.01, updated));
      this.fundingRates[contract.symbol] = +clamped.toFixed(5);
    });
  }

  private revalueAccount() {
    let unrealized = 0;
    Object.values(this.positions).forEach((position) => {
      if (!position) return;
      const price = this.getMarkPrice(position.symbol);
      const pnlPerUnit =
        position.side === "LONG"
          ? price - position.entryPrice
          : position.entryPrice - price;
      unrealized += pnlPerUnit * position.size;
    });
    this.account.unrealizedPnl = +unrealized.toFixed(2);
    this.account.equity = +(
      this.account.balance +
      this.account.unrealizedPnl
    ).toFixed(2);
  }

  private recordTrade(trade: FuturesTrade) {
    this.trades = [trade, ...this.trades];
    if (this.trades.length > 100) {
      this.trades.length = 100;
    }
  }

  private recordPrice(symbol: string, price: number) {
    const history = this.priceHistory[symbol] ?? [];
    const next = [...history, { time: Date.now(), price }];
    if (next.length > FuturesEngine.HISTORY_LIMIT) {
      next.splice(0, next.length - FuturesEngine.HISTORY_LIMIT);
    }
    this.priceHistory[symbol] = next;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private evaluateAutoCloses() {
    Object.entries(this.positions).forEach(([symbol, position]) => {
      if (!position) return;
      const mark = this.getMarkPrice(symbol);
      // Evaluate stop-loss first to mimic protective behaviour.
      if (this.shouldTrigger(position, mark, "STOP_LOSS")) {
        this.forceClosePosition(symbol, mark, "STOP_LOSS");
        return;
      }
      if (this.shouldTrigger(position, mark, "TAKE_PROFIT")) {
        this.forceClosePosition(symbol, mark, "TAKE_PROFIT");
      }
    });
  }

  private shouldTrigger(
    position: FuturesPosition,
    mark: number,
    type: FuturesAutoCloseTrigger
  ) {
    if (type === "STOP_LOSS") {
      const { stopLoss } = position;
      if (stopLoss == null) return false;
      return position.side === "LONG" ? mark <= stopLoss : mark >= stopLoss;
    }
    const { takeProfit } = position;
    if (takeProfit == null) return false;
    return position.side === "LONG" ? mark >= takeProfit : mark <= takeProfit;
  }

  private forceClosePosition(
    symbol: string,
    mark: number,
    trigger: FuturesAutoCloseTrigger
  ) {
    const existing = this.positions[symbol];
    if (!existing) return;

    const pnlPerUnit =
      existing.side === "LONG"
        ? mark - existing.entryPrice
        : existing.entryPrice - mark;
    const realizedPnl = pnlPerUnit * existing.size;

    this.account.balance += realizedPnl;
    this.account.realizedPnl += realizedPnl;
    this.account.marginUsed -= existing.margin;
    this.account.availableMargin += existing.margin;
    this.positions[symbol] = undefined;

    this.recordTrade({
      id: Math.random().toString(36).slice(2),
      symbol,
      side: existing.side,
      size: existing.size,
      price: mark,
      leverage: existing.leverage,
      realizedPnl,
      timestamp: Date.now(),
      status: "CLOSED",
      trigger,
    });

    this.revalueAccount();
    this.normalizeAccount();
    this.emit();
  }

  private seedPrice(base: string) {
    switch (base) {
      case "BTC":
        return 69000;
      case "ETH":
        return 3300;
      case "SOL":
        return 150;
      default:
        return 100;
    }
  }

  private randomFundingRate() {
    return +((Math.random() - 0.5) * 0.001).toFixed(5);
  }

  private roundToTick(price: number, tick: number) {
    return +((Math.round(price / tick) * tick).toFixed(8));
  }

  private normalizeAccount() {
    this.account.marginUsed = +Math.max(0, this.account.marginUsed).toFixed(2);
    this.account.availableMargin = +Math.max(
      0,
      this.account.availableMargin
    ).toFixed(2);
    this.account.balance = +this.account.balance.toFixed(2);
    this.account.realizedPnl = +this.account.realizedPnl.toFixed(2);
    this.account.equity = +this.account.equity.toFixed(2);
  }
}

export const futuresEngine = new FuturesEngine();
