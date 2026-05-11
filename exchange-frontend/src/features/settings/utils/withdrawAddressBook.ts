export type WithdrawNetworkKey = "tron" | "bsc" | "ethereum";

export type WithdrawAddressHistoryEntry = {
  network: WithdrawNetworkKey;
  address: string;
  savedAt: string;
};

export type WithdrawAddressBook = {
  current: Partial<Record<WithdrawNetworkKey, string>>;
  history: WithdrawAddressHistoryEntry[];
};

const STORAGE_KEY = "exchange.withdrawAddressBook.v1";

const emptyBook = (): WithdrawAddressBook => ({
  current: {},
  history: [],
});

export function loadWithdrawAddressBook(): WithdrawAddressBook {
  if (typeof window === "undefined") return emptyBook();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBook();
    const parsed = JSON.parse(raw) as Partial<WithdrawAddressBook>;
    return {
      current: parsed.current && typeof parsed.current === "object" ? parsed.current : {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return emptyBook();
  }
}

export function saveWithdrawAddressBook(book: WithdrawAddressBook) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
}

export function mergeWithdrawAddressBook(
  previous: WithdrawAddressBook,
  nextCurrent: Partial<Record<WithdrawNetworkKey, string>>
): WithdrawAddressBook {
  const mergedCurrent: Partial<Record<WithdrawNetworkKey, string>> = {
    ...previous.current,
  };
  const history = [...previous.history];

  (Object.entries(nextCurrent) as Array<[WithdrawNetworkKey, string | undefined]>).forEach(([network, value]) => {
    const normalized = value?.trim() || "";
    if (!normalized) return;

    if (mergedCurrent[network] !== normalized) {
      mergedCurrent[network] = normalized;
      history.unshift({
        network,
        address: normalized,
        savedAt: new Date().toISOString(),
      });
    }
  });

  return {
    current: mergedCurrent,
    history: history.slice(0, 30),
  };
}
