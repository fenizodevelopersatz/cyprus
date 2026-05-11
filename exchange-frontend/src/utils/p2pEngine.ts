export type P2PListingType = "BUY" | "SELL";

export type P2PListing = {
  id: string;
  type: P2PListingType;
  asset: string;
  fiatCurrency: string;
  price: number;
  minAmount: number;
  maxAmount: number;
  paymentMethods: string[];
  completionRate: number;
  trader: {
    name: string;
    tier: "Gold" | "Silver" | "Platinum";
    trades: number;
    avgReleaseMinutes: number;
    verified: boolean;
  };
};

export type P2POrderStatus = "ESCROW_LOCKED" | "WAITING_PAYMENT" | "PAID" | "RELEASED" | "CANCELLED";

export type P2POrder = {
  id: string;
  listingId: string;
  type: P2PListingType;
  asset: string;
  fiatCurrency: string;
  price: number;
  fiatAmount: number;
  cryptoAmount: number;
  status: P2POrderStatus;
  escrow: {
    funded: boolean;
    released: boolean;
    amount: number;
  };
  createdAt: number;
  counterpart: P2PListing["trader"];
};

export type P2PMessageAuthor = "YOU" | "COUNTERPARTY" | "SYSTEM";

export type P2PMessage = {
  id: string;
  orderId: string;
  author: P2PMessageAuthor;
  body: string;
  timestamp: number;
};

export type P2PUserProfile = {
  id: string;
  name: string;
  tier: "Pro" | "Advanced";
  kycVerified: boolean;
  lastUpdated: number;
};

type Listener = () => void;

const LISTINGS: P2PListing[] = [
  {
    id: "p2p-1",
    type: "BUY",
    asset: "USDT",
    fiatCurrency: "USD",
    price: 1.01,
    minAmount: 100,
    maxAmount: 10000,
    paymentMethods: ["Bank Transfer", "Apple Pay"],
    completionRate: 99,
    trader: {
      name: "StableDesk",
      tier: "Platinum",
      trades: 1284,
      avgReleaseMinutes: 5,
      verified: true,
    },
  },
  {
    id: "p2p-2",
    type: "BUY",
    asset: "BTC",
    fiatCurrency: "USD",
    price: 69420,
    minAmount: 200,
    maxAmount: 25000,
    paymentMethods: ["Bank Transfer"],
    completionRate: 97,
    trader: {
      name: "BlockMint",
      tier: "Gold",
      trades: 884,
      avgReleaseMinutes: 7,
      verified: true,
    },
  },
  {
    id: "p2p-3",
    type: "SELL",
    asset: "USDT",
    fiatCurrency: "USD",
    price: 0.995,
    minAmount: 50,
    maxAmount: 8000,
    paymentMethods: ["Wise", "Revolut", "Cash App"],
    completionRate: 98,
    trader: {
      name: "FlowMarkets",
      tier: "Gold",
      trades: 620,
      avgReleaseMinutes: 4,
      verified: true,
    },
  },
  {
    id: "p2p-4",
    type: "SELL",
    asset: "ETH",
    fiatCurrency: "USD",
    price: 3320,
    minAmount: 100,
    maxAmount: 12000,
    paymentMethods: ["Bank Transfer", "PayPal"],
    completionRate: 96,
    trader: {
      name: "EtherLane",
      tier: "Silver",
      trades: 540,
      avgReleaseMinutes: 6,
      verified: false,
    },
  },
  {
    id: "p2p-5",
    type: "BUY",
    asset: "USDC",
    fiatCurrency: "USD",
    price: 1,
    minAmount: 150,
    maxAmount: 12000,
    paymentMethods: ["Bank Transfer", "ACH"],
    completionRate: 99,
    trader: {
      name: "CircleHub",
      tier: "Platinum",
      trades: 1560,
      avgReleaseMinutes: 3,
      verified: true,
    },
  },
];

export class P2PEngine {
  private listings: P2PListing[] = LISTINGS;
  private orders: P2POrder[] = [];
  private messages: Record<string, P2PMessage[]> = {};
  private listeners: Set<Listener> = new Set();
  private timers: Map<string, number> = new Map();

  private user: P2PUserProfile = {
    id: "user-primary",
    name: "CryptoSignal Trader",
    tier: "Advanced",
    kycVerified: false,
    lastUpdated: Date.now(),
  };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  getListings() {
    return this.listings.slice();
  }

  getOrders() {
    return this.orders.slice();
  }

  getMessages(orderId: string) {
    return (this.messages[orderId] ?? []).slice();
  }

  getAllMessages() {
    const entries = Object.entries(this.messages).map(([orderId, msgs]) => [orderId, msgs.slice()]);
    return Object.fromEntries(entries);
  }

  getUser() {
    return { ...this.user };
  }

  verifyUser() {
    this.user = {
      ...this.user,
      kycVerified: true,
      lastUpdated: Date.now(),
    };
    this.emit();
  }

  resetVerification() {
    this.user = {
      ...this.user,
      kycVerified: false,
      lastUpdated: Date.now(),
    };
    this.emit();
  }

  createOrder(listingId: string, fiatAmount: number) {
    if (!this.user.kycVerified) {
      throw new Error("KYC verification required to place P2P orders.");
    }
    const listing = this.listings.find((item) => item.id === listingId);
    if (!listing) {
      throw new Error("Listing not found.");
    }
    if (fiatAmount < listing.minAmount || fiatAmount > listing.maxAmount) {
      throw new Error(`Amount must be between ${listing.minAmount} and ${listing.maxAmount} ${listing.fiatCurrency}.`);
    }
    const cryptoAmount = +(fiatAmount / listing.price).toFixed(6);
    const order: P2POrder = {
      id: Math.random().toString(36).slice(2),
      listingId,
      type: listing.type,
      asset: listing.asset,
      fiatCurrency: listing.fiatCurrency,
      price: listing.price,
      fiatAmount,
      cryptoAmount,
      status: "ESCROW_LOCKED",
      escrow: {
        funded: true,
        released: false,
        amount: cryptoAmount,
      },
      createdAt: Date.now(),
      counterpart: listing.trader,
    };

    this.orders = [order, ...this.orders];
    this.messages[order.id] = [
      this.buildMessage(order.id, "SYSTEM", `Escrow secured ${order.cryptoAmount} ${order.asset}. Payment instructions shared privately.`),
      this.buildMessage(order.id, "COUNTERPARTY", "Hello! Please proceed with payment within 15 minutes and share confirmation here."),
    ];
    this.emit();

    this.scheduleFollowUp(order.id, 12000, () => {
      this.appendMessage(order.id, {
        author: "SYSTEM",
        body: "Escrow reminder: update payment status when completed.",
      });
    });

    return order;
  }

  markAsPaid(orderId: string) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order) {
      throw new Error("Order not found.");
    }
    if (order.status !== "ESCROW_LOCKED" && order.status !== "WAITING_PAYMENT") {
      return;
    }

    order.status = "PAID";
    this.appendMessage(orderId, {
      author: "YOU",
      body: "Payment sent. Please confirm receipt.",
    });
    this.appendMessage(orderId, {
      author: "SYSTEM",
      body: "Payment marked as complete. Counterparty will review and release funds shortly.",
    });
    this.emit();

    this.scheduleFollowUp(orderId, 6000, () => {
      if (order.status !== "PAID") return;
      order.status = "RELEASED";
      order.escrow.released = true;
      this.appendMessage(orderId, {
        author: "COUNTERPARTY",
        body: "Payment confirmed. Releasing funds now.",
      });
      this.appendMessage(orderId, {
        author: "SYSTEM",
        body: `Escrow released. ${order.cryptoAmount} ${order.asset} credited to your spot wallet.`,
      });
      this.emit();
    });
  }

  cancelOrder(orderId: string) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order) return;
    if (order.status === "RELEASED") return;
    order.status = "CANCELLED";
    order.escrow.funded = false;
    order.escrow.released = false;
    this.appendMessage(orderId, {
      author: "YOU",
      body: "Order cancelled by user.",
    });
    this.appendMessage(orderId, {
      author: "SYSTEM",
      body: "Escrow released back to counterparty. Trade closed.",
    });
    this.emit();
    this.clearTimer(orderId);
  }

  acknowledgePaymentWindow(orderId: string) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order) return;
    if (order.status !== "ESCROW_LOCKED") return;
    order.status = "WAITING_PAYMENT";
    this.appendMessage(orderId, {
      author: "YOU",
      body: "Acknowledged escrow. Reviewing payment instructions now.",
    });
    this.emit();
  }

  sendMessage(orderId: string, author: P2PMessageAuthor, body: string) {
    if (!body.trim()) return;
    this.appendMessage(orderId, {
      author,
      body,
    });
    this.emit();
  }

  private buildMessage(orderId: string, author: P2PMessageAuthor, body: string): P2PMessage {
    return {
      id: `${orderId}-${Math.random().toString(36).slice(2)}`,
      orderId,
      author,
      body,
      timestamp: Date.now(),
    };
  }

  private appendMessage(orderId: string, message: Omit<P2PMessage, "id" | "timestamp" | "orderId">) {
    const entry = {
      id: `${orderId}-${Math.random().toString(36).slice(2)}`,
      orderId,
      author: message.author,
      body: message.body,
      timestamp: Date.now(),
    };
    const existing = this.messages[orderId] ?? [];
    this.messages[orderId] = [...existing, entry];
  }

  private scheduleFollowUp(orderId: string, delay: number, callback: () => void) {
    this.clearTimer(orderId);
    const timer = window.setTimeout(() => {
      this.timers.delete(orderId);
      callback();
    }, delay);
    this.timers.set(orderId, timer);
  }

  private clearTimer(orderId: string) {
    const timer = this.timers.get(orderId);
    if (timer) {
      window.clearTimeout(timer);
      this.timers.delete(orderId);
    }
  }
}

export const p2pEngine = new P2PEngine();
