import { useEffect, useSyncExternalStore } from "react";
import {
  p2pEngine,
  type P2PListing,
  type P2POrder,
  type P2PMessage,
  type P2PUserProfile,
} from "../utils/p2pEngine";

type Snapshot = {
  listings: P2PListing[];
  orders: P2POrder[];
  messages: Record<string, P2PMessage[]>;
  user: P2PUserProfile;
};

const buildSnapshot = (): Snapshot => ({
  listings: p2pEngine.getListings(),
  orders: p2pEngine.getOrders(),
  messages: p2pEngine.getAllMessages(),
  user: p2pEngine.getUser(),
});

let currentSnapshot: Snapshot = buildSnapshot();

const subscribeStore = (listener: () => void) => {
  const unsubscribe = p2pEngine.subscribe(() => {
    currentSnapshot = buildSnapshot();
    listener();
  });
  return unsubscribe;
};

const getSnapshot = () => currentSnapshot;

export function useP2PEngine() {
  useEffect(() => {
    currentSnapshot = buildSnapshot();
  }, []);

  const snapshot = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);

  return {
    ...snapshot,
    verifyUser: p2pEngine.verifyUser.bind(p2pEngine),
    resetVerification: p2pEngine.resetVerification.bind(p2pEngine),
    createOrder: p2pEngine.createOrder.bind(p2pEngine),
    acknowledgePaymentWindow: p2pEngine.acknowledgePaymentWindow.bind(p2pEngine),
    markAsPaid: p2pEngine.markAsPaid.bind(p2pEngine),
    cancelOrder: p2pEngine.cancelOrder.bind(p2pEngine),
    sendMessage: p2pEngine.sendMessage.bind(p2pEngine),
  };
}
