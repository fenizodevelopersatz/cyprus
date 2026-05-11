import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { subscribeToWalletRealtime } from "./walletRealtime";

export const WALLET_BALANCE_REFRESH_EVENT = "wallet-balance-refresh";
const DEFAULT_BALANCE = "0.00";

type WalletBalancePayload = {
  mainWalletBalance?: string;
  main_wallet_balance?: string;
  user?: {
    main_wallet_balance?: string;
    mainWalletBalance?: string;
  };
  data?: {
    main_wallet_balance?: string;
    mainWalletBalance?: string;
  };
  balance?: {
    total?: string;
  };
};

const readMainWalletBalance = (summary: unknown) => {
  const payload = (summary ?? {}) as WalletBalancePayload;
  return String(
    payload.mainWalletBalance ??
      payload.main_wallet_balance ??
      payload.user?.main_wallet_balance ??
      payload.user?.mainWalletBalance ??
      payload.data?.main_wallet_balance ??
      payload.data?.mainWalletBalance ??
      payload.balance?.total ??
      "0"
  );
};

export const dispatchWalletBalanceRefresh = () => {
  window.dispatchEvent(new CustomEvent(WALLET_BALANCE_REFRESH_EVENT));
};

export function useLiveWalletBalance() {
  const [totalUsdt, setTotalUsdt] = useState(DEFAULT_BALANCE);
  const refreshTickRef = useRef(0);

  const refreshBalance = useCallback(() => {
    refreshTickRef.current += 1;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToWalletRealtime((summary) => {
      const nextBalance = readMainWalletBalance(summary);
      startTransition(() => {
        setTotalUsdt(nextBalance);
      });
    });

    const handleForcedRefresh = () => {
      refreshBalance();
    };

    window.addEventListener(WALLET_BALANCE_REFRESH_EVENT, handleForcedRefresh as EventListener);

    return () => {
      unsubscribe();
      window.removeEventListener(WALLET_BALANCE_REFRESH_EVENT, handleForcedRefresh as EventListener);
    };
  }, [refreshBalance]);

  return {
    totalUsdt,
    refreshBalance,
  };
}
