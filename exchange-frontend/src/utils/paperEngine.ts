export type SymbolInfo = { symbol: string; price: number; step: number };
export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export type PaperOrder = {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  price?: number;
  qty: number;
  status: "NEW" | "FILLED" | "CANCELED" | "PARTIALLY_FILLED";
  filled: number;
  createdAt: number;
};

export type Position = { symbol: string; qty: number; avgPrice: number };

export type DepthLevel = { price: number; qty: number; total: number };
export type Trade = {
  id: string;
  symbol: string;
  side: Side;
  price: number;
  qty: number;
  ts: number;
};
export type PricePoint = { time: number; price: number };
export type OrderBookSnapshot = { bids: DepthLevel[]; asks: DepthLevel[] };
export type TickerSnapshot = {
  symbol: string;
  last: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
};

export type SwapQuote = {
  amountIn: number;
  usdtValue: number;
  midAmountOut: number;
  amountOut: number;
  effectivePrice: number;
};

export type SwapExecution = SwapQuote & {
  id: string;
  timestamp: number;
  fromToken: string;
  toToken: string;
  slippagePct: number;
  impactPct: number;
  routing: string;
};

export type SwapRequest = {
  fromToken: string;
  toToken: string;
  amountIn: number;
  slippagePct: number;
  impactPct?: number;
  routing: string;
};

type Listener = () => void;

const HISTORY_LIMIT = 720;
const TRADE_LIMIT = 160;
const DEPTH_LEVELS = 14;

export class PaperEngine {
  balances: Record<string, number> = { USDT: 10000 };
  positions: Record<string, Position> = {};
  orders: PaperOrder[] = [];
  prices: Record<string, number> = {};
  symbolMeta: Record<string, SymbolInfo> = {};
  history: Record<string, PricePoint[]> = {};
  trades: Record<string, Trade[]> = {};
  orderBook: Record<string, OrderBookSnapshot> = {};
  syms: SymbolInfo[];
  assets: string[] = [];
  swapHistory: SwapExecution[] = [];
  listeners: Set<Listener> = new Set();
  timer?: number;

  constructor(symbols: SymbolInfo[]) {
    this.syms = symbols;
    const assetSet = new Set<string>(["USDT"]);
    symbols.forEach((s) => {
      this.symbolMeta[s.symbol] = s;
      this.prices[s.symbol] = s.price;
      this.history[s.symbol] = [{ time: Date.now(), price: s.price }];
      this.trades[s.symbol] = [];
      this.orderBook[s.symbol] = this.buildOrderBookSnapshot(s.symbol, s.price);
      const { base, quote } = this.parsePair(s.symbol);
      if (base) assetSet.add(base);
      if (quote) assetSet.add(quote);
    });
    this.assets = Array.from(assetSet);
    this.assets.forEach((asset) => {
      if (this.balances[asset] === undefined) {
        this.balances[asset] = asset === "USDT" ? this.balances.USDT ?? 0 : 0;
      }
    });
  }

  subscribe(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  start() {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      this.syms.forEach((s) => {
        const p = this.prices[s.symbol];
        const drift = p * 0.001 * (Math.random() - 0.5);
        const next = Math.max(0.0001, p + drift);
        const rounded = Math.round(next / s.step) * s.step;
        const updated = +rounded.toFixed(8);
        this.prices[s.symbol] = updated;
        this.recordPrice(s.symbol, updated);
        this.trades[s.symbol] = this.generateTrades(s.symbol, updated);
        this.orderBook[s.symbol] = this.buildOrderBookSnapshot(
          s.symbol,
          updated
        );
      });
      this.match();
      this.emit();
    }, 900);
  }

  stop() {
    if (this.timer) {
      window.clearInterval(this.timer);
    }
    this.timer = undefined;
  }

  getMid(symbol: string) {
    return this.prices[symbol];
  }

  getTokenPrice(token: string) {
    if (token === "USDT") return 1;
    const direct = this.prices[`${token}USDT`];
    if (direct) return direct;
    const inverse = this.prices[`USDT${token}`];
    if (inverse) {
      if (inverse === 0) return 0;
      return +(1 / inverse).toFixed(8);
    }
    return this.prices[token];
  }

  quoteSwap({
    fromToken,
    toToken,
    amountIn,
    slippagePct,
    impactPct = 0,
  }: Omit<SwapRequest, "routing">): SwapQuote | null {
    if (amountIn <= 0) return null;
    const fromPrice = this.getTokenPrice(fromToken);
    const toPrice = this.getTokenPrice(toToken);
    if (!fromPrice || !toPrice) return null;

    const usdtValue =
      fromToken === "USDT" ? amountIn : +(amountIn * fromPrice).toFixed(8);
    const midAmountOut =
      toToken === "USDT" ? usdtValue : +(usdtValue / toPrice).toFixed(8);
    const combinedImpact = Math.max(0, slippagePct + impactPct);
    const impactFactor = Math.max(0, 1 - combinedImpact / 100);
    const amountOut = +(midAmountOut * impactFactor).toFixed(8);
    const effectivePrice =
      amountIn > 0 ? +(amountOut / amountIn).toFixed(8) : 0;

    return {
      amountIn: +amountIn.toFixed(8),
      usdtValue,
      midAmountOut,
      amountOut,
      effectivePrice,
    };
  }

  swapTokens(request: SwapRequest): SwapExecution | null {
    const { fromToken, toToken, amountIn, slippagePct, impactPct = 0, routing } =
      request;
    if (fromToken === toToken) return null;
    if (amountIn <= 0) return null;

    const available = this.balances[fromToken] ?? 0;
    if (available < amountIn) return null;

    const quote = this.quoteSwap({
      fromToken,
      toToken,
      amountIn,
      slippagePct,
      impactPct,
    });

    if (!quote) return null;

    this.balances[fromToken] = +(available - amountIn).toFixed(8);
    const targetCurrent = this.balances[toToken] ?? 0;
    this.balances[toToken] = +(targetCurrent + quote.amountOut).toFixed(8);

    const execution: SwapExecution = {
      id: Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      fromToken,
      toToken,
      amountIn: quote.amountIn,
      usdtValue: quote.usdtValue,
      midAmountOut: quote.midAmountOut,
      amountOut: quote.amountOut,
      effectivePrice: quote.effectivePrice,
      slippagePct,
      impactPct,
      routing,
    };

    this.swapHistory = [execution, ...this.swapHistory];
    if (this.swapHistory.length > 40) {
      this.swapHistory.length = 40;
    }

    this.emit();
    return execution;
  }

  placeOrder(payload: {
    symbol: string;
    side: Side;
    type: OrderType;
    price?: number;
    qty: number;
  }): PaperOrder {
    const id = Math.random().toString(36).slice(2);
    const o: PaperOrder = {
      id,
      status: "NEW",
      filled: 0,
      createdAt: Date.now(),
      ...payload,
    };
    this.orders = [o, ...this.orders];

    if (o.type === "MARKET") {
      this.fill(o, this.getMid(o.symbol), o.qty);
    } else {
      const midPx = this.getMid(o.symbol);
      if (
        (o.side === "BUY" && o.price! >= midPx) ||
        (o.side === "SELL" && o.price! <= midPx)
      ) {
        this.fill(o, midPx, o.qty);
      }
    }
    this.emit();
    return o;
  }

  cancel(id: string) {
    const o = this.orders.find((x) => x.id === id);
    if (!o || o.status === "FILLED") return;
    o.status = "CANCELED";
    this.emit();
  }

  private fill(o: PaperOrder, px: number, qty: number) {
    const cost = +(px * qty).toFixed(8);
    if (o.side === "BUY") {
      if (this.balances.USDT < cost) return;
      this.balances.USDT -= cost;
      const pos = this.positions[o.symbol] || {
        symbol: o.symbol,
        qty: 0,
        avgPrice: 0,
      };
      const newQty = pos.qty + qty;
      const newAvg =
        newQty === 0 ? 0 : (pos.avgPrice * pos.qty + px * qty) / newQty;
      this.positions[o.symbol] = {
        symbol: o.symbol,
        qty: +newQty.toFixed(8),
        avgPrice: +newAvg.toFixed(8),
      };
    } else {
      const posQty = this.positions[o.symbol]?.qty || 0;
      if (posQty < qty) return;
      this.positions[o.symbol].qty = +(posQty - qty).toFixed(8);
      this.balances.USDT += cost;
    }
    o.filled += qty;
    o.status = "FILLED";
    const updatedTrades: Trade[] = [
      {
        id: `${o.id}-${Date.now()}`,
        symbol: o.symbol,
        side: o.side,
        price: px,
        qty,
        ts: Date.now(),
      },
      ...(this.trades[o.symbol] ?? []),
    ];
    if (updatedTrades.length > TRADE_LIMIT) {
      updatedTrades.length = TRADE_LIMIT;
    }
    this.trades[o.symbol] = updatedTrades;
  }

  private match() {
    const mid = (sym: string) => this.getMid(sym);
    this.orders.forEach((o) => {
      if (o.status !== "NEW") return;
      const m = mid(o.symbol);
      if (
        (o.side === "BUY" && o.price! >= m) ||
        (o.side === "SELL" && o.price! <= m)
      ) {
        this.fill(o, m, o.qty);
      }
    });
  }

  unrealizedPnl(sym: string) {
    const pos = this.positions[sym];
    if (!pos || pos.qty === 0) return 0;
    return +((this.getMid(sym) - pos.avgPrice) * pos.qty).toFixed(8);
  }

  equityUSDT() {
    const walletValue = Object.entries(this.balances).reduce(
      (sum, [token, amount]) => {
        if (!amount) return sum;
        if (token === "USDT") return sum + amount;
        const px = this.getTokenPrice(token);
        if (!px) return sum;
        return sum + amount * px;
      },
      0
    );
    const spotValue = Object.values(this.positions).reduce((sum, p) => {
      const px = this.getMid(p.symbol);
      return sum + px * p.qty;
    }, 0);
    return +(walletValue + spotValue).toFixed(2);
  }

  getTicker(symbol: string): TickerSnapshot {
    const history = this.history[symbol] ?? [];
    const last = this.prices[symbol] ?? 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = history.filter((p) => p.time >= cutoff);
    const sample = recent.length > 0 ? recent : history;
    const open = sample[0]?.price ?? last;
    const base = open || last || 1;
    let high = last;
    let low = last;
    if (sample.length > 0) {
      high = sample.reduce(
        (max, p) => (p.price > max ? p.price : max),
        sample[0].price
      );
      low = sample.reduce(
        (min, p) => (p.price < min ? p.price : min),
        sample[0].price
      );
    }
    const change = +(last - base).toFixed(2);
    const changePct =
      base !== 0 ? +(((last - base) / base) * 100).toFixed(2) : 0;
    const trades = this.trades[symbol] ?? [];
    const volume = trades
      .filter((t) => t.ts >= cutoff)
      .reduce((sum, t) => sum + t.qty, 0);

    return {
      symbol,
      last,
      open: base,
      high: +high.toFixed(4),
      low: +low.toFixed(4),
      change,
      changePct,
      volume: +volume.toFixed(4),
    };
  }

  getHistory(symbol: string, points = HISTORY_LIMIT): PricePoint[] {
    const history = this.history[symbol] ?? [];
    const start = Math.max(0, history.length - points);
    return history.slice(start);
  }

  getOrderBook(symbol: string): OrderBookSnapshot {
    const book = this.orderBook[symbol];
    if (!book) return { bids: [], asks: [] };
    return {
      bids: book.bids.slice(),
      asks: book.asks.slice(),
    };
  }

  getTrades(symbol: string): Trade[] {
    const trades = this.trades[symbol] ?? [];
    return trades.slice();
  }

  private recordPrice(symbol: string, price: number) {
    const history = this.history[symbol] ?? [];
    const next = [...history, { time: Date.now(), price }];
    if (next.length > HISTORY_LIMIT) {
      next.splice(0, next.length - HISTORY_LIMIT);
    }
    this.history[symbol] = next;
  }

  private generateTrades(symbol: string, mid: number): Trade[] {
    const info = this.symbolMeta[symbol];
    if (!info) return this.trades[symbol] ?? [];
    const existing = this.trades[symbol] ?? [];
    const next = existing.slice();
    const iterations = Math.random() < 0.8 ? 1 : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < iterations; i += 1) {
      const side: Side = Math.random() > 0.5 ? "BUY" : "SELL";
      const jitter = mid * 0.0008 * (Math.random() - 0.5);
      const px = this.roundToStep(mid + jitter, info.step);
      const qty = +(Math.random() * 0.6 + 0.01).toFixed(4);
      next.unshift({
        id: Math.random().toString(36).slice(2),
        symbol,
        side,
        price: px,
        qty,
        ts: Date.now(),
      });
    }
    if (next.length > TRADE_LIMIT) next.length = TRADE_LIMIT;
    return next;
  }

  private buildOrderBookSnapshot(
    symbol: string,
    mid: number
  ): OrderBookSnapshot {
    const info = this.symbolMeta[symbol];
    if (!info) return { bids: [], asks: [] };
    const bids: DepthLevel[] = [];
    const asks: DepthLevel[] = [];
    let bidTotal = 0;
    let askTotal = 0;

    for (let i = 1; i <= DEPTH_LEVELS; i += 1) {
      const stepFactor = 0.6 + Math.random() * 0.8;
      const bidPrice = Math.max(
        info.step,
        this.roundToStep(mid - info.step * i * stepFactor, info.step)
      );
      const askPrice = this.roundToStep(
        mid + info.step * i * stepFactor,
        info.step
      );
      const bidQty = +(Math.random() * 3 + 0.01).toFixed(4);
      const askQty = +(Math.random() * 3 + 0.01).toFixed(4);
      bidTotal += bidQty;
      askTotal += askQty;
      bids.push({
        price: bidPrice,
        qty: bidQty,
        total: +bidTotal.toFixed(4),
      });
      asks.push({
        price: askPrice,
        qty: askQty,
        total: +askTotal.toFixed(4),
      });
    }

    return {
      bids: bids.sort((a, b) => b.price - a.price),
      asks: asks.sort((a, b) => a.price - b.price),
    };
  }

  private roundToStep(price: number, step: number) {
    return +((Math.round(price / step) * step).toFixed(8));
  }

  private parsePair(symbol: string) {
    const knownQuotes = ["USDT", "USDC", "BTC", "ETH"];
    for (const quote of knownQuotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, symbol.length - quote.length);
        return { base, quote };
      }
    }
    return { base: symbol, quote: "USDT" };
  }
}

export const paperEngine = new PaperEngine([
  { symbol: "BTCUSDT", price: 69000, step: 0.1 },
  { symbol: "ETHUSDT", price: 3300, step: 0.01 },
  { symbol: "SOLUSDT", price: 150, step: 0.01 },
]);
