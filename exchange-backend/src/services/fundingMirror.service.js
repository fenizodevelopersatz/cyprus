import { db } from '../db.js';
import { listUserWallets, provisionUserWallets } from './userWalletService.js';
import { getSignalAssetByNetwork, listSignalAssets } from './signalAssetService.js';
import { generateGlobalTxnId } from '../utils/generateGlobalTxnId.js';

const NETWORK_MAP = {
  ERC20: 'ethereum',
  BEP20: 'bsc',
  TRC20: 'tron',
  ethereum: 'ethereum',
  bsc: 'bsc',
  tron: 'tron',
};

const TYPE_MAP = {
  ethereum: 'ERC',
  bsc: 'BEP',
  tron: 'TRC',
};

export function normalizeFundingNetwork(value) {
  return NETWORK_MAP[String(value || '').trim()] || NETWORK_MAP[String(value || '').trim().toUpperCase()] || '';
}

export function getFundingType(network) {
  return TYPE_MAP[normalizeFundingNetwork(network)] || 'ERC';
}

export function buildCanonicalDepositTransactionIdsQuery(
  userId,
  { network = null, token = 'USDT', creditedOnly = false } = {}
) {
  const normalizedNetwork = normalizeFundingNetwork(network);
  return db('deposit_transactions as dt')
    .where('dt.user_id', userId)
    .andWhere('dt.token', token)
    .modify((builder) => {
      if (normalizedNetwork) builder.andWhere('dt.network', normalizedNetwork);
      if (creditedOnly) builder.andWhere('dt.credited', 1);
    })
    .groupBy('dt.network', 'dt.tx_hash', 'dt.log_index')
    .select(db.raw('MAX(dt.id) as id'));
}

function getEthereumExplorerBase(assetConfig) {
  const chainId = String(assetConfig?.chainId || '').trim();
  const rpcUrl = String(assetConfig?.rpcUrl || '').toLowerCase();
  if (chainId === '11155111' || rpcUrl.includes('sepolia')) return 'https://sepolia.etherscan.io/tx/';
  if (chainId === '5' || rpcUrl.includes('goerli')) return 'https://goerli.etherscan.io/tx/';
  return 'https://etherscan.io/tx/';
}

function getBscExplorerBase(assetConfig) {
  const chainId = String(assetConfig?.chainId || '').trim();
  const rpcUrl = String(assetConfig?.rpcUrl || '').toLowerCase();
  if (chainId === '97' || rpcUrl.includes('testnet')) return 'https://testnet.bscscan.com/tx/';
  return 'https://bscscan.com/tx/';
}

function getTronExplorerBase(assetConfig) {
  const fullHost = String(assetConfig?.fullHost || '').toLowerCase();
  if (fullHost.includes('tronscan.org')) {
    if (fullHost.includes('nile')) return 'https://nile.tronscan.org/#/transaction/';
    if (fullHost.includes('shasta')) return 'https://shasta.tronscan.org/#/transaction/';
    return 'https://tronscan.org/#/transaction/';
  }
  if (fullHost.includes('nile')) return 'https://nile.tronscan.org/#/transaction/';
  if (fullHost.includes('shasta')) return 'https://shasta.tronscan.org/#/transaction/';
  return 'https://tronscan.org/#/transaction/';
}

function getTronAddressExplorerBase(assetConfig) {
  const fullHost = String(assetConfig?.fullHost || '').toLowerCase();
  if (fullHost.includes('tronscan.org')) {
    if (fullHost.includes('nile')) return 'https://nile.tronscan.org/#/address/';
    if (fullHost.includes('shasta')) return 'https://shasta.tronscan.org/#/address/';
    return 'https://tronscan.org/#/address/';
  }
  if (fullHost.includes('nile')) return 'https://nile.tronscan.org/#/address/';
  if (fullHost.includes('shasta')) return 'https://shasta.tronscan.org/#/address/';
  return 'https://tronscan.org/#/address/';
}

export async function buildExplorerUrl(network, txHash) {
  const normalized = normalizeFundingNetwork(network);
  if (!txHash) return null;
  const assetNetwork = normalized === 'ethereum' ? 'ERC20' : normalized === 'bsc' ? 'BEP20' : 'TRC20';
  const assetConfig = await getSignalAssetByNetwork(assetNetwork);
  if (normalized === 'ethereum') return `${getEthereumExplorerBase(assetConfig)}${txHash}`;
  if (normalized === 'bsc') return `${getBscExplorerBase(assetConfig)}${txHash}`;
  if (normalized === 'tron') return `${getTronExplorerBase(assetConfig)}${txHash}`;
  return null;
}

export async function buildAddressExplorerUrl(network, address) {
  const normalized = normalizeFundingNetwork(network);
  const trimmedAddress = String(address || '').trim();
  if (!trimmedAddress) return null;
  const assetNetwork = normalized === 'ethereum' ? 'ERC20' : normalized === 'bsc' ? 'BEP20' : 'TRC20';
  const assetConfig = await getSignalAssetByNetwork(assetNetwork);
  if (normalized === 'ethereum') return `${String(getEthereumExplorerBase(assetConfig)).replace(/\/tx\/?$/i, '/address/')}${trimmedAddress}`;
  if (normalized === 'bsc') return `${String(getBscExplorerBase(assetConfig)).replace(/\/tx\/?$/i, '/address/')}${trimmedAddress}`;
  if (normalized === 'tron') return `${getTronAddressExplorerBase(assetConfig)}${trimmedAddress}`;
  return null;
}

function normalizeAddress(network, address) {
  const raw = String(address || '').trim();
  if (!raw) return raw;
  return normalizeFundingNetwork(network) === 'tron' ? raw : raw.toLowerCase();
}

export async function syncWalletAddressesForUser(userId) {
  await provisionUserWallets(userId);
  const [wallets, assets] = await Promise.all([
    listUserWallets(userId),
    listSignalAssets({ includeDisabled: false }),
  ]);

  const assetMap = new Map(assets.map((asset) => [normalizeFundingNetwork(asset.network), asset]));
  for (const wallet of wallets) {
    const network = normalizeFundingNetwork(wallet.network);
    if (!network) continue;
    const assetConfig = assetMap.get(network);
    const existing = await db('wallet_addresses')
      .where({ user_id: userId, network, token: 'USDT' })
      .first();

    const payload = {
      user_id: userId,
      network,
      token: 'USDT',
      label: assetConfig?.displayName || (network === 'ethereum' ? 'USDT Ethereum' : network === 'bsc' ? 'USDT BSC' : 'USDT TRON'),
      address: wallet.address,
      address_lower: network === 'tron' ? null : String(wallet.address || '').toLowerCase(),
      is_active: true,
      memo_tag: null,
      meta: assetConfig ? JSON.stringify({ chain: wallet.network, assetId: assetConfig.id }) : null,
      updated_at: wallet.updatedAt || new Date(),
    };

    if (existing) {
      await db('wallet_addresses').where({ id: existing.id }).update(payload);
    } else {
      try {
        await db('wallet_addresses').insert({
          ...payload,
          created_at: wallet.createdAt || new Date(),
        });
      } catch (err) {
        const isDuplicate =
          err?.code === 'ER_DUP_ENTRY' ||
          String(err?.message || '').includes('wallet_addresses_user_network_token_unique');
        if (!isDuplicate) throw err;

        const duplicateRow = await db('wallet_addresses')
          .where({ user_id: userId, network, token: 'USDT' })
          .first();
        if (!duplicateRow) throw err;

        await db('wallet_addresses').where({ id: duplicateRow.id }).update(payload);
      }
    }
  }
}

export async function syncDepositTransactionsForUser(userId) {
  await syncWalletAddressesForUser(userId);
  const [walletAddresses, assets] = await Promise.all([
    db('wallet_addresses').where({ user_id: userId, token: 'USDT' }).select('*'),
    listSignalAssets({ includeDisabled: true }),
  ]);
  const walletAddressMap = new Map(walletAddresses.map((row) => [`${row.network}:${normalizeAddress(row.network, row.address)}`, row]));
  console.log('Wallet Address Map:', walletAddressMap);
  const assetMap = new Map(assets.map((asset) => [normalizeFundingNetwork(asset.network), asset]));
  const legacyRows = await db('deposits')
    .where({ user_id: userId })
    .andWhere((query) => {
      query.where({ token_key: 'usdt' }).orWhere({ asset: 'USDT' });
    })
    .orderBy('created_at', 'desc');

  for (const row of legacyRows) {
    const network = normalizeFundingNetwork(row.network_key || row.chain);
    if (!network) continue;
    const assetConfig = assetMap.get(network) || null;
    const toAddress = normalizeAddress(network, row.to_address);
    const walletAddress = walletAddressMap.get(`${network}:${toAddress}`) || null;
    const existing = await db('deposit_transactions')
      .where({
        network,
        token: 'USDT',
        tx_hash: row.tx_hash,
        log_index: Number(row.log_index || 0),
      })
      .first();
    const txnId = existing?.txn_id || row.txn_id || (await generateGlobalTxnId(db, 'DEP'));

    const payload = {
      user_id: userId,
      wallet_address_id: walletAddress?.id || null,
      network,
      token: 'USDT',
      txn_id: txnId,
      type: getFundingType(network),
      tx_hash: row.tx_hash,
      log_index: Number(row.log_index || 0),
      contract_address: row.contract_address || row.token_contract || assetConfig?.contractAddress || null,
      from_address: row.from_address || null,
      to_address: row.to_address || null,
      deposit_address: walletAddress?.address || row.to_address || null,
      amount_decimal: String(row.amount || '0'),
      block_number: row.block_number || null,
      confirmation_count: Number(row.confirmations || 0),
      confirmation_target: Number(row.confirmation_target || 0),
      status: row.status || 'detected',
      is_success: true,
      is_inbound: true,
      credited: Boolean(row.credited || row.status === 'credited'),
      confirmed_at: row.confirmed_at || null,
      credited_at: row.credited_at || null,
      raw_payload: row.raw_payload || null,
      meta: row.meta || null,
      updated_at: row.updated_at || new Date(),
    };

    if (existing) {
      await db('deposit_transactions').where({ id: existing.id }).update(payload);
    } else {
      await db('deposit_transactions').insert({
        ...payload,
        created_at: row.created_at || new Date(),
      });
    }
  }
}

export async function syncDepositChainCursors() {
  const hasTable = await db.schema.hasTable('deposit_scan_state');
  if (!hasTable) return;
  const legacyRows = await db('deposit_scan_state').select('*');
  for (const row of legacyRows) {
    const network = normalizeFundingNetwork(row.network);
    if (!network) continue;
    const existing = await db('deposit_chain_cursors')
      .where({ network, token: 'USDT' })
      .first();
    const payload = {
      network,
      token: 'USDT',
      last_scanned_block: Number(row.last_processed_block || 0),
      cursor_value: row.cursor_value || null,
      cursor_meta: row.cursor_meta || null,
      last_synced_at: row.last_synced_at || row.updated_at || new Date(),
      updated_at: row.updated_at || new Date(),
    };
    if (existing) {
      await db('deposit_chain_cursors').where({ id: existing.id }).update(payload);
    } else {
      await db('deposit_chain_cursors').insert({
        ...payload,
        created_at: row.created_at || new Date(),
      });
    }
  }
}
