import { useEffect, useState, useCallback } from "react";
import {
  fetchOrderSnapshot,
  postCancelOrder,
  type OrdersSnapshotDTO,
} from "../api/orders.api";

export function useOrdersData() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<OrdersSnapshotDTO>({
    openOrders: [],
    history: [],
    trades: [],
    counts: { open: 0, filled: 0, canceled: 0 },
  });

  const refresh = useCallback(async () => {
    try {
      setErr(null);
      setLoading(true);
      const snap = await fetchOrderSnapshot({ openLimit: 50, historyLimit: 100, tradeLimit: 40 });
      setData({
        openOrders: snap.openOrders ?? [],
        history: snap.history ?? [],
        trades: snap.trades ?? [],
        counts: snap.counts ?? undefined,
      });
    } catch (e: any) {
      setErr(e?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelOrder = useCallback(async (id: string) => {
    await postCancelOrder(id);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000); // poll; remove once websockets added
    return () => clearInterval(id);
  }, [refresh]);

  return { ...data, loading, err, refresh, cancelOrder };
}
