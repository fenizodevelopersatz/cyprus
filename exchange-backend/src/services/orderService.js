import { db } from '../db.js';
import { openOrders as fetchSpotOpenOrders } from './exchangeService.js';

const OPEN_STATUSES = ['NEW', 'PARTIALLY_FILLED'];
const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_ADMIN_LIMIT = 50;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeOrder(row) {
  const qty = toNumber(row.size ?? row.quantity ?? row.qty);
  const filled = toNumber(row.filled ?? row.executed);
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    status: row.status,
    price: row.price ? toNumber(row.price) : null,
    qty,
    quantity: qty,
    filled,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getOpenOrders(userId, limit = 50) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 50;
  const rows = await fetchSpotOpenOrders(userId).catch(() => []);
  const sliced = safeLimit ? rows.slice(0, safeLimit) : rows;
  return sliced.map((row) => {
    const qty = row.qty ?? toNumber(row.size ?? row.quantity ?? row.qty);
    const filled = row.filled ?? toNumber(row.filled);
    const created = row.createdAt ?? row.created_at;
    const updated = row.updatedAt ?? row.updated_at;
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      price: row.price ? toNumber(row.price) : null,
      qty,
      filled,
      status: row.status,
      createdAt: toIso(created) || created,
      updatedAt: toIso(updated) || updated,
    };
  });
}

export async function getOrderHistory(userId, limit = 50) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 50;
  const rows = await db('spot_orders')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(safeLimit);
  return rows.map(normalizeOrder);
}

export async function getRecentTrades(userId, limit = 25) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 25;
  const rows = await db('spot_trades as t')
    .join('spot_orders as o', 't.order_id', 'o.id')
    .where('o.user_id', userId)
    .orderBy('t.created_at', 'desc')
    .limit(safeLimit)
    .select(
      't.id',
      'o.symbol',
      'o.side',
      't.price',
      't.size',
      't.created_at'
    )
    .select('t.id', 'o.symbol', 'o.side', 't.price', 't.size', 't.created_at', 't.updated_at');

  return rows.map((row) => {
    const qty = toNumber(row.size ?? row.quantity ?? row.qty);
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      price: toNumber(row.price),
      qty,
      quantity: qty,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  });
}

async function statusCounts(userId) {
  const rows = await db('spot_orders')
    .where({ user_id: userId })
    .groupBy('status')
    .select('status')
    .count({ count: '*' });

  const map = rows.reduce((acc, row) => {
    const status = row.status;
    const raw =
      row.count ??
      row.Count ??
      row['count(*)'] ??
      row['COUNT(*)'] ??
      Object.values(row).find((value, index) => index !== 0);
    const count = Number(raw ?? 0);
    acc[status] = Number.isFinite(count) ? count : 0;
    return acc;
  }, {});

  const open = OPEN_STATUSES.reduce((sum, status) => sum + (map[status] || 0), 0);
  const filled = map.FILLED || 0;
  const canceled = (map.CANCELED || 0) + (map.EXPIRED || 0);

  return { open, filled, canceled };
}

export async function getOrderSnapshot(userId, { openLimit, historyLimit, tradeLimit } = {}) {
  const [openOrders, history, trades, counts] = await Promise.all([
    getOpenOrders(userId, openLimit),
    getOrderHistory(userId, historyLimit),
    getRecentTrades(userId, tradeLimit),
    statusCounts(userId),
  ]);

  return {
    openOrders,
    history,
    recentTrades: trades,
    counts: { ...counts, open: openOrders.length },
    updatedAt: new Date().toISOString(),
  };
}

function adminOrderQuery() {
  return db('spot_orders as o')
    .join('users as u', 'u.id', 'o.user_id')
    .leftJoin('user_profiles as p', 'p.user_id', 'u.id')
    .select(
      'o.*',
      'u.email',
      'u.country',
      'p.display_name'
    );
}

function normalizeAdminOrder(row) {
  const base = normalizeOrder(row);
  return {
    ...base,
    userId: row.user_id,
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name || null,
      country: row.country || null,
    },
  };
}

function applyAdminFilters(query, { userId, search, symbol }) {
  if (userId) {
    query.andWhere('o.user_id', Number(userId));
  }
  if (symbol) {
    query.andWhere('o.symbol', String(symbol).toUpperCase());
  }
  if (search) {
    const value = `%${search.trim()}%`;
    query.andWhere((builder) => {
      builder.whereILike('u.email', value);
      builder.orWhereILike('p.display_name', value);
    });
  }
}

function safeAdminLimit(limit) {
  const raw = Number(limit);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 500) : DEFAULT_ADMIN_LIMIT;
}

export async function adminOpenOrders(filters = {}) {
  const limit = safeAdminLimit(filters.limit);
  const query = adminOrderQuery()
    .whereIn('o.status', OPEN_STATUSES)
    .orderBy('o.created_at', 'desc')
    .limit(limit);
  applyAdminFilters(query, filters);
  const rows = await query;
  return rows.map(normalizeAdminOrder);
}

export async function adminRecentOrders(filters = {}) {
  const limit = safeAdminLimit(filters.limit);
  const query = adminOrderQuery()
    .orderBy('o.created_at', 'desc')
    .limit(limit);
  applyAdminFilters(query, filters);
  if (filters.status) {
    query.andWhere('o.status', String(filters.status).toUpperCase());
  }
  return (await query).map(normalizeAdminOrder);
}

export async function adminRecentTrades(filters = {}) {
  const limit = safeAdminLimit(filters.limit);
  const query = db('spot_trades as t')
    .join('spot_orders as o', 't.order_id', 'o.id')
    .join('users as u', 'o.user_id', 'u.id')
    .leftJoin('user_profiles as p', 'p.user_id', 'u.id')
    .orderBy('t.created_at', 'desc')
    .limit(limit)
    .select(
      't.id',
      't.size',
      't.price',
      't.created_at',
      'o.symbol',
      'o.side',
      'o.user_id',
      'u.email',
      'u.country',
      'p.display_name'
    );
  applyAdminFilters(query, filters);
  const rows = await query;
  return rows.map((row) => {
    const qty = toNumber(row.size ?? row.quantity ?? row.qty);
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      price: toNumber(row.price),
      qty,
      quantity: qty,
      createdAt: toIso(row.created_at),
      userId: row.user_id,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name || null,
        country: row.country || null,
      },
    };
  });
}
