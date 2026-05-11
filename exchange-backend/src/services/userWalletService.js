import { Wallet } from 'ethers';
import { db } from '../db.js';
import { encryptText } from '../utils/crypto.js';
import { createTronAccount } from '../utils/tron.js';

const SUPPORTED_NETWORKS = ['ERC20', 'BEP20', 'TRC20'];

function normalizeAddress(network, address) {
  const raw = String(address || '').trim();
  if (!raw) return raw;
  return network === 'TRC20' ? raw : raw.toLowerCase();
}

function mapWalletRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    network: row.network,
    address: row.address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meta: row.meta || null,
  };
}

export function createEvmWallet() {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

export async function createTronWallet() {
  try {
    const account = await createTronAccount();
    return {
      address: account.address?.base58,
      privateKey: account.privateKey,
    };
  } catch (err) {
    const error = new Error('TRON_WALLET_PROVIDER_UNAVAILABLE');
    error.status = 500;
    error.cause = err;
    throw error;
  }
}

async function generateWalletForNetwork(network) {
  if (network === 'TRC20') return createTronWallet();
  return createEvmWallet();
}

async function createWalletRecord(userId, network, wallet, trx) {
  const conn = trx || db;
  const now = new Date();
  const encryptedKey = encryptText(wallet.privateKey);
  const inserted = await conn('user_wallets')
    .insert({
      user_id: userId,
      network,
      address: normalizeAddress(network, wallet.address),
      private_key_encrypted: encryptedKey,
      created_at: now,
      updated_at: now,
    });
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  const row = await conn('user_wallets').where({ id }).first();
  return mapWalletRow(row);
}

export async function provisionUserWallets(userId, { trx } = {}) {
  const conn = trx || db;
  const existingRows = await conn('user_wallets').where({ user_id: userId });
  const existingMap = new Map(existingRows.map((row) => [row.network, mapWalletRow(row)]));
  const created = [];

  for (const network of SUPPORTED_NETWORKS) {
    if (existingMap.has(network)) continue;
    const wallet = await generateWalletForNetwork(network);
    const record = await createWalletRecord(userId, network, wallet, conn);
    existingMap.set(network, record);
    created.push(record);
  }

  return {
    wallets: SUPPORTED_NETWORKS.reduce((acc, network) => {
      const record = existingMap.get(network);
      if (record) acc[network] = record.address;
      return acc;
    }, {}),
    records: Array.from(existingMap.values()),
    created,
  };
}

export async function getUserWalletByNetwork(userId, network, { trx } = {}) {
  const conn = trx || db;
  const normalized = String(network || '').trim().toUpperCase();
  if (!SUPPORTED_NETWORKS.includes(normalized)) return null;
  const row = await conn('user_wallets').where({ user_id: userId, network: normalized }).first();
  return row ? mapWalletRow(row) : null;
}

export async function listUserWallets(userId, { trx } = {}) {
  const conn = trx || db;
  const rows = await conn('user_wallets').where({ user_id: userId }).orderBy([{ column: 'network', order: 'asc' }]);
  return rows.map(mapWalletRow);
}

export async function findWalletOwnerByAddress(network, address, { trx } = {}) {
  const conn = trx || db;
  const normalizedNetwork = String(network || '').trim().toUpperCase();
  const normalizedAddress = String(address || '').trim();
  if (!normalizedNetwork || !normalizedAddress) return null;
  const row = await conn('user_wallets')
    .where({ network: normalizedNetwork, address: normalizeAddress(normalizedNetwork, normalizedAddress) })
    .first();
  return row ? mapWalletRow(row) : null;
}
