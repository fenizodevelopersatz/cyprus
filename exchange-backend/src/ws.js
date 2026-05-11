import { Server } from 'socket.io';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './middleware/auth.js';
import { exchangeEmitter } from './services/binanceSync.js';
import { exchangeSnapshot, wallets as fetchWallets, openOrders as fetchOpenOrders } from './services/exchangeService.js';
import { getPortfolioSnapshot } from './services/portfolioService.js';
import { getWalletRealtimeSnapshot, walletRealtimeEmitter } from './services/walletRealtime.service.js';
import { getKycQueueSidebarSummary, kycAdminEmitter } from './services/kycService.js';

const ALLOWLIST = [
    process.env.APP_BASE_DOMAIN,
];

function isAllowedOrigin(origin) {
  return !origin || ALLOWLIST.includes(origin);
}

function resolveSocketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return authToken;
  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string') return queryToken;
  const headerAuth = socket.handshake.headers?.authorization;
  if (headerAuth?.startsWith('Bearer ')) return headerAuth.slice(7);
  return null;
}

export function createWs(httpServer) {


 // const io = new Server(httpServer, { cors: { origin: '*' } });

  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket', 'polling'], // keep polling for older browsers
    cors: {
      origin: (origin, cb) => {
        if (isAllowedOrigin(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST'],
      credentials: true, // allow cookies/Auth headers if you use them
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    },
  });

  io.on('connection', (socket) => {
    socket.on('subscribe', (room) => socket.join(room));
    socket.on('unsubscribe', (room) => socket.leave(room));
  });

  const exchangeNs = io.of('/exchange');

  exchangeNs.use((socket, next) => {
    try {
      const token = resolveSocketToken(socket);
      const payload = verifyToken(token);
      socket.user = payload;
      return next();
    } catch (err) {
      return next(err);
    }
  });

  exchangeNs.on('connection', (socket) => {
    if (socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
    }

    socket.on('exchange:subscribe', async ({ symbol }) => {
      if (!symbol) return;
      const upper = String(symbol).toUpperCase();
      socket.join(`symbol:${upper}`);
      const snapshot = await exchangeSnapshot(upper, socket.user?.id).catch(() => null);
      if (snapshot) socket.emit('exchange:snapshot', snapshot);
    });

    socket.on('exchange:unsubscribe', ({ symbol }) => {
      if (!symbol) return;
      const upper = String(symbol).toUpperCase();
      socket.leave(`symbol:${upper}`);
    });
  });

  exchangeEmitter.on('ticker', (payload) => {
    const room = `symbol:${payload.symbol}`;
    exchangeNs.to(room).emit('exchange:ticker', payload);
  });

  exchangeEmitter.on('orderbook', (payload) => {
    const room = `symbol:${payload.symbol}`;
    exchangeNs.to(room).emit('exchange:orderbook', payload);
  });

  exchangeEmitter.on('trade', ({ symbol, trade }) => {
    exchangeNs.to(`symbol:${symbol}`).emit('exchange:trade', trade);
  });

  exchangeEmitter.on('wallet', async ({ userId }) => {
    if (!userId) return;
    const snapshot = await fetchWallets(userId).catch(() => null);
    if (snapshot) {
      const payload = snapshot.map((wallet) => ({
        asset: wallet.asset,
        free: wallet.free ?? wallet.balance ?? 0,
        locked: wallet.locked ?? 0,
        balance: wallet.balance ?? (wallet.free ?? 0) + (wallet.locked ?? 0),
      }));
      exchangeNs.to(`user:${userId}`).emit('exchange:wallet', payload);
    }
  });

  exchangeEmitter.on('order', async ({ userId }) => {
    if (!userId) return;
    const orders = await fetchOpenOrders(userId).catch(() => null);
    if (orders) {
      const payload = orders.map((order) => ({
        id: String(order.id),
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        price: order.price,
        qty: order.qty ?? order.quantity ?? 0,
        filled: order.filled ?? 0,
        status: order.status,
        createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      }));
      exchangeNs.to(`user:${userId}`).emit('exchange:order', payload);
    }
  });

  const rawExchangeWs = new WebSocketServer({ noServer: true });
  const portfolioWs = new WebSocketServer({ noServer: true });
  const walletWs = new WebSocketServer({ noServer: true });
  const adminDashboardWs = new WebSocketServer({ noServer: true });

  const attachRawListeners = (ws, symbol, userId) => {
    const send = (event, data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, data }));
      }
    };

    const tickerListener = (payload) => {
      if (payload.symbol === symbol) send('exchange:ticker', payload);
    };
    const orderbookListener = (payload) => {
      if (payload.symbol === symbol) send('exchange:orderbook', payload);
    };
    const tradeListener = ({ symbol: tradeSymbol, trade }) => {
      if (tradeSymbol === symbol) send('exchange:trade', trade);
    };
    const walletListener = async ({ userId: targetId }) => {
      if (!userId || targetId !== userId) return;
      const snapshot = await fetchWallets(userId).catch(() => null);
      if (snapshot) {
        const payload = snapshot.map((wallet) => ({
          asset: wallet.asset,
          free: wallet.free ?? wallet.balance ?? 0,
          locked: wallet.locked ?? 0,
          balance: wallet.balance ?? (wallet.free ?? 0) + (wallet.locked ?? 0),
        }));
        send('exchange:wallet', payload);
      }
    };
    const orderListener = async ({ userId: targetId }) => {
      if (!userId || targetId !== userId) return;
      const orders = await fetchOpenOrders(userId).catch(() => null);
      if (orders) {
        const payload = orders.map((order) => ({
          id: String(order.id),
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          price: order.price,
          qty: order.qty ?? order.quantity ?? 0,
          filled: order.filled ?? 0,
          status: order.status,
          createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
        }));
        send('exchange:order', payload);
      }
    };

    exchangeEmitter.on('ticker', tickerListener);
    exchangeEmitter.on('orderbook', orderbookListener);
    exchangeEmitter.on('trade', tradeListener);
    exchangeEmitter.on('wallet', walletListener);
    exchangeEmitter.on('order', orderListener);

    const cleanup = () => {
      exchangeEmitter.off('ticker', tickerListener);
      exchangeEmitter.off('orderbook', orderbookListener);
      exchangeEmitter.off('trade', tradeListener);
      exchangeEmitter.off('wallet', walletListener);
      exchangeEmitter.off('order', orderListener);
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  };

  rawExchangeWs.on('connection', async (ws, request) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const symbolParam = url.searchParams.get('symbol');
      if (!symbolParam) {
        ws.close(1008, 'symbol required');
        return;
      }
      const symbol = symbolParam.toUpperCase();
      const token = url.searchParams.get('token') || url.searchParams.get('access_token');
      let userId = null;
      if (token) {
        try {
          const payload = verifyToken(token);
          userId = payload?.id ?? null;
        } catch (err) {
          // ignore invalid token; connection will operate as public feed
        }
      }

      const snapshot = await exchangeSnapshot(symbol, userId).catch(() => null);
      if (snapshot && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: 'exchange:snapshot', data: snapshot }));
      }
      attachRawListeners(ws, symbol, userId);
    } catch (err) {
      ws.close(1011, 'unexpected error');
    }
  });

  portfolioWs.on('connection', async (ws, request) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }
      let userId = null;
      try {
        const payload = verifyToken(token);
        userId = payload?.id ?? null;
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }
      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }

      const snapshot = await getPortfolioSnapshot(userId).catch(() => null);
      if (snapshot && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'portfolio:snapshot',
            event: 'portfolio:snapshot',
            data: snapshot,
          })
        );
      }
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'unexpected error');
      }
    }
  });

  walletWs.on('connection', async (ws, request) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }

      let userId = null;
      try {
        const payload = verifyToken(token);
        userId = payload?.id ?? null;
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }

      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }

      const sendSummary = async (eventName, payload = null) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const summary = payload ?? (await getWalletRealtimeSnapshot(userId).catch(() => null));
        if (!summary) return;
        ws.send(
          JSON.stringify({
            type: eventName,
            event: eventName,
            data: summary,
          })
        );
      };

      const handleWalletUpdate = ({ userId: targetUserId, summary }) => {
        if (targetUserId !== userId) return;
        void sendSummary('wallet:update', summary);
      };

      walletRealtimeEmitter.on('wallet:update', handleWalletUpdate);
      ws.on('close', () => walletRealtimeEmitter.off('wallet:update', handleWalletUpdate));
      ws.on('error', () => walletRealtimeEmitter.off('wallet:update', handleWalletUpdate));

      await sendSummary('wallet:snapshot');
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'unexpected error');
      }
    }
  });

  adminDashboardWs.on('connection', async (ws, request) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token') || url.searchParams.get('access_token');
      if (!token) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }

      let auth = null;
      try {
        auth = verifyToken(token);
      } catch (_err) {
        ws.send(JSON.stringify({ type: 'error', code: 401, message: 'Unauthorized' }));
        ws.close(4401, 'unauthorized');
        return;
      }

      const roles = Array.isArray(auth?.roles) ? auth.roles.map((role) => String(role).toLowerCase()) : [];
      if (!roles.includes('admin')) {
        ws.send(JSON.stringify({ type: 'error', code: 403, message: 'Forbidden' }));
        ws.close(4403, 'forbidden');
        return;
      }

      const sendSummary = async (eventName, detail = null) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const kyc = await getKycQueueSidebarSummary().catch(() => null);
        ws.send(
          JSON.stringify({
            type: eventName,
            event: eventName,
            data: {
              kyc,
              detail,
              sentAt: new Date().toISOString(),
            },
          })
        );
      };

      const handleKycUpdate = (detail) => {
        void sendSummary('admin:kyc:queue-updated', detail);
      };

      kycAdminEmitter.on('kyc:queue-updated', handleKycUpdate);
      ws.on('close', () => kycAdminEmitter.off('kyc:queue-updated', handleKycUpdate));
      ws.on('error', () => kycAdminEmitter.off('kyc:queue-updated', handleKycUpdate));

      await sendSummary('admin:dashboard:ready');
    } catch (_err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'unexpected error');
      }
    }
  });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      if (pathname === '/ws/exchange') {
        rawExchangeWs.handleUpgrade(request, socket, head, (ws) => {
          rawExchangeWs.emit('connection', ws, request);
        });
        return;
      }
      if (pathname === '/ws/portfolio') {
        portfolioWs.handleUpgrade(request, socket, head, (ws) => {
          portfolioWs.emit('connection', ws, request);
        });
        return;
      }
      if (pathname === '/ws/wallet') {
        walletWs.handleUpgrade(request, socket, head, (ws) => {
          walletWs.emit('connection', ws, request);
        });
        return;
      }
      if (pathname === '/ws/admin/dashboard') {
        adminDashboardWs.handleUpgrade(request, socket, head, (ws) => {
          adminDashboardWs.emit('connection', ws, request);
        });
        return;
      }
    } catch (err) {
      socket.destroy();
    }
  });

  return io;
}
