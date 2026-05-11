import { useEffect, useSyncExternalStore } from "react";
import {
  futuresEngine,
  type FuturesAccount,
  type FuturesContract,
  type FuturesPosition,
  type FuturesTrade,
  type FuturesPricePoint,
} from "../utils/futuresEngine";

type FuturesSnapshot = {
  contracts: FuturesContract[];
  markPrices: Record<string, number>;
  fundingRates: Record<string, number>;
  positions: Record<string, FuturesPosition | undefined>;
  trades: FuturesTrade[];
  account: FuturesAccount;
  history: Record<string, FuturesPricePoint[]>;
  lastUpdatedAt: number;
};

const buildSnapshot = (): FuturesSnapshot => {
  const contracts = futuresEngine.getContracts();
  const markPrices = contracts.reduce<Record<string, number>>((acc, contract) => {
    acc[contract.symbol] = futuresEngine.getMarkPrice(contract.symbol);
    return acc;
  }, {});
  const fundingRates = contracts.reduce<Record<string, number>>((acc, contract) => {
    acc[contract.symbol] = futuresEngine.getFundingRate(contract.symbol);
    return acc;
  }, {});
  const history = contracts.reduce<Record<string, FuturesPricePoint[]>>((acc, contract) => {
    acc[contract.symbol] = futuresEngine.getHistory(contract.symbol, 160);
    return acc;
  }, {});

  return {
    contracts,
    markPrices,
    fundingRates,
    positions: futuresEngine.getPositions(),
    trades: futuresEngine.getTrades(),
    account: futuresEngine.getAccount(),
    history,
    lastUpdatedAt: futuresEngine.getLastUpdatedAt(),
  };
};

let currentSnapshot: FuturesSnapshot = buildSnapshot();

const subscribeStore = (listener: () => void) => {
  const unsubscribe = futuresEngine.subscribe(() => {
    currentSnapshot = buildSnapshot();
    listener();
  });
  return unsubscribe;
};

const getSnapshot = () => currentSnapshot;

export function useFuturesEngine() {
  useEffect(() => {
    futuresEngine.start();
    return () => futuresEngine.stop();
  }, []);

  const snapshot = useSyncExternalStore<FuturesSnapshot>(
    subscribeStore,
    getSnapshot,
    getSnapshot
  );

  return {
    ...snapshot,
    openPosition: futuresEngine.openPosition.bind(futuresEngine),
    closePosition: futuresEngine.closePosition.bind(futuresEngine),
    setPositionTriggers: futuresEngine.setPositionTriggers.bind(futuresEngine),
  };
}
