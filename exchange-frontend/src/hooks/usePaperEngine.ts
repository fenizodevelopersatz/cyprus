import { useSyncExternalStore } from "react";
import { paperEngine } from "../utils/paperEngine";
import type {
  OrderBookSnapshot,
  PaperOrder,
  Position,
  PricePoint,
  SwapExecution,
  TickerSnapshot,
  Trade,
} from "../utils/paperEngine";

type PaperSnapshot = {
  prices: Record<string, number>;
  balances: Record<string, number>;
  positions: Record<string, Position>;
  orders: PaperOrder[];
  equity: number;
  swapHistory: SwapExecution[];
};

const buildSnapshot = (): PaperSnapshot => ({
  prices: { ...paperEngine.prices },
  balances: { ...paperEngine.balances },
  positions: { ...paperEngine.positions },
  orders: [...paperEngine.orders],
  equity: paperEngine.equityUSDT(),
  swapHistory: [...(paperEngine.swapHistory ?? [])],
});

let currentSnapshot: PaperSnapshot = buildSnapshot();

const subscribeStore = (cb: () => void) => {
  const unsubscribe = paperEngine.subscribe(() => {
    currentSnapshot = buildSnapshot();
    cb();
  });
  return unsubscribe;
};

const getSnapshot = () => currentSnapshot;

export function usePaperEngine() {
  const snapshot = useSyncExternalStore<PaperSnapshot>(
    subscribeStore,
    getSnapshot,
    getSnapshot
  );

  return {
    ...snapshot,
    syms: paperEngine.syms.slice(),
    symbols: paperEngine.syms.slice(),
    assets: paperEngine.assets.slice(),
    swapHistory: snapshot.swapHistory,
    getTicker: (symbol: string): TickerSnapshot => paperEngine.getTicker(symbol),
    getHistory: (symbol: string, points?: number): PricePoint[] =>
      paperEngine.getHistory(symbol, points),
    getOrderBook: (symbol: string): OrderBookSnapshot =>
      paperEngine.getOrderBook(symbol),
    getTrades: (symbol: string): Trade[] => paperEngine.getTrades(symbol),
    placeOrder: paperEngine.placeOrder.bind(paperEngine),
    cancelOrder: paperEngine.cancel.bind(paperEngine),
    unrealizedPnl: paperEngine.unrealizedPnl.bind(paperEngine),
    quoteSwap: paperEngine.quoteSwap.bind(paperEngine),
    getTokenPrice: paperEngine.getTokenPrice.bind(paperEngine),
    swapTokens: paperEngine.swapTokens.bind(paperEngine),
  };
}
