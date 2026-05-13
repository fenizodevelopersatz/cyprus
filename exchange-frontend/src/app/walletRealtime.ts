import { WALLET_WS_PATH, WS_BASE_URL } from "./apiRoutes";
import { getStoredAccessToken } from "../features/auth/state/session.storage";

type WalletSummary = {
  mainWalletBalance?: string;
  main_wallet_balance?: string;
  balance?: {
    total?: string;
    breakdown?: Record<string, string>;
  };
  updatedAt?: string | null;
};

type WalletRealtimeListener = (summary: WalletSummary) => void;

const listeners = new Set<WalletRealtimeListener>();

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

const clearReconnectTimer = () => {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const buildWalletWsUrl = (): string | null => {
  try {
    const base = new URL(WS_BASE_URL);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/?$/, "")}${WALLET_WS_PATH}`;
    const token = getStoredAccessToken();
    if (!token) return null;
    base.searchParams.set("token", token);
    return base.toString();
  } catch {
    return null;
  }
};

const broadcast = (summary: WalletSummary) => {
  listeners.forEach((listener) => listener(summary));
};

const connect = () => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = buildWalletWsUrl();
  if (!url) return;

  clearReconnectTimer();
  socket = new WebSocket(url);

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { event?: string; type?: string; data?: WalletSummary };
      const eventName = payload.event ?? payload.type;
      if (eventName === "wallet:snapshot" || eventName === "wallet:update") {
        if (payload.data) {
          broadcast(payload.data);
        }
      }
    } catch {
      // ignore malformed socket payloads
    }
  };

  socket.onclose = () => {
    socket = null;
    if (listeners.size === 0) return;
    reconnectTimer = window.setTimeout(() => {
      connect();
    }, 3000);
  };

  socket.onerror = () => {
    if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };
};

const disconnectIfIdle = () => {
  if (listeners.size > 0) return;
  clearReconnectTimer();
  if (socket && socket.readyState <= WebSocket.OPEN) {
    socket.close();
  }
  socket = null;
};

export const subscribeToWalletRealtime = (listener: WalletRealtimeListener) => {
  listeners.add(listener);
  connect();

  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
};
