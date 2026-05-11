import axios from 'axios';
import { db } from '../db.js';
import { getSignalAssetByNetwork } from './signalAssetService.js';
import { getUserWalletByNetwork } from './userWalletService.js';
import { normalizeAddress, saveDepositAndCredit } from './depositSyncService.js';
import { bscLogger, depositLogger, ethereumLogger, tronLogger } from '../logging/loggers.js';
import { getTronClient, normalizeTronHost } from '../utils/tron.js';

const TRON_EVENT_PAGE_SIZE = Number(process.env.TRON_EVENT_PAGE_SIZE || 200);
const TRON_EVENT_PAGE_LIMIT = Number(process.env.TRON_EVENT_PAGE_LIMIT || 50);
const EVM_PAGE_SIZE = Number(process.env.EXPLORER_EVM_PAGE_SIZE || 1000);
const EVM_PAGE_LIMIT = Number(process.env.EXPLORER_EVM_PAGE_LIMIT || 100);
const TRON_GRID_PAGE_SIZE = Number(process.env.TRON_GRID_PAGE_SIZE || 200);
const TRON_SCAN_PAGE_SIZE = Number(process.env.TRON_SCAN_PAGE_SIZE || 200);
const TRON_SCAN_PAGE_LIMIT = Number(process.env.TRON_SCAN_PAGE_LIMIT || 100);
const AXIOS_DIRECT_REQUEST = {
  timeout: 15000,
  proxy: false,
};

function getExplorerLogger(network) {
  if (network === 'ERC20') return ethereumLogger;
  if (network === 'BEP20') return bscLogger;
  if (network === 'TRC20') return tronLogger;
  return depositLogger;
}

function requireExplorerConfig(value, code) {
  if (value) return value;
  const err = new Error(code);
  err.status = 400;
  throw err;
}

function getEnvValue(name) {
  const value = String(process.env[name] || '').trim();
  return value || null;
}

function isLoopbackUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return ['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(parsed.hostname);
  } catch {
    return /127\.0\.0\.1|localhost|0\.0\.0\.0|::1/i.test(raw);
  }
}

function resolveEvmExplorerBaseUrl(network, assetConfig) {
  const envKey = network === 'ERC20' ? 'ETH_API_URL' : 'BSC_API_URL';
  const fallback = network === 'ERC20' ? 'https://api.etherscan.io' : 'https://api.bscscan.com';
  const candidates = [
    getEnvValue(envKey),
    assetConfig?.fullHost,
    assetConfig?.rpcUrl,
    fallback,
  ];

  return candidates.find((candidate) => candidate && !isLoopbackUrl(candidate)) || fallback;
}

function resolveTronExplorerBaseUrl(assetConfig) {
  const assetHost = normalizeTronHost(String(assetConfig?.fullHost || '').trim());
  const rpcUrl = normalizeTronHost(String(assetConfig?.rpcUrl || '').trim());
  const configuredHost = normalizeTronHost(getEnvValue('TRON_FULL_HOST'));
  const fallback = assetHost && !isLoopbackUrl(assetHost) ? assetHost : 'https://nile.trongrid.io';
  const candidates = [
    getEnvValue('TRX_API_URL'),
    assetHost,
    rpcUrl,
    configuredHost,
    fallback,
  ];

  return candidates
    .map((candidate) => normalizeTronHost(candidate))
    .find((candidate) => candidate && !isLoopbackUrl(candidate)) || fallback;
}

function resolveExplorerApiKey(envKey) {
  return requireExplorerConfig(getEnvValue(envKey), `${envKey}_NOT_CONFIGURED`);
}

function buildTronWeb(assetConfig) {
  const fullHost = requireExplorerConfig(resolveTronExplorerBaseUrl(assetConfig), 'TRX_API_URL_NOT_CONFIGURED');
  return getTronClient({ fullHost });
}

function parseMeta(meta) {
  if (!meta) return null;
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return null;
  }
}

function buildScanApiUrls(baseUrl) {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  return {
    v2: /\/v2\/api$/i.test(cleanBase) ? cleanBase : cleanBase.replace(/\/api$/i, '') + '/v2/api',
    v1: /\/api$/i.test(cleanBase) ? cleanBase : cleanBase + '/api',
  };
}

function isLikelyHtmlResponse(axiosResponse) {
  const contentType = axiosResponse?.headers?.['content-type'] || axiosResponse?.headers?.['Content-Type'];
  const body = axiosResponse?.data;
  if (typeof body === 'string') {
    const head = body.slice(0, 200).toLowerCase();
    if (head.includes('<!doctype html') || head.includes('<html')) return true;
  }
  return typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
}

async function getScanWithFallback({ urls, params, label }) {
  try {
    const v2 = await axios.get(urls.v2, { ...AXIOS_DIRECT_REQUEST, params });
    if (isLikelyHtmlResponse(v2)) {
      throw Object.assign(new Error(`${label} returned HTML from v2`), { _forceFallback: true, response: v2 });
    }
    return v2;
  } catch (err) {
    const status = err?.response?.status;
    const shouldFallback = status === 404 || err?._forceFallback || isLikelyHtmlResponse(err?.response);
    if (!shouldFallback) throw err;
    return axios.get(urls.v1, { ...AXIOS_DIRECT_REQUEST, params });
  }
}

function mapStoredDeposit(row) {
  return {
    id: `deposit-${row.id}`,
    type: 'deposit',
    asset: row.asset,
    chain: row.chain,
    amount: row.amount,
    status: 'completed',
    txHash: row.tx_hash,
    txId: row.tx_hash,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    createdAt: row.created_at,
    completedAt: row.confirmed_at,
    meta: parseMeta(row.meta),
  };
}

function formatEvmList(list, decimals, network) {
  if (!Array.isArray(list)) return [];
  return list.map((tx) => ({
    chain: network,
    txHash: String(tx.hash || ''),
    logIndex: Number(tx.logIndex ?? tx.transactionIndex ?? 0),
    blockNumber: Number(tx.blockNumber ?? 0),
    confirmations: Number(tx.confirmations ?? 0),
    fromAddress: tx.from,
    toAddress: tx.to,
    amount: (Number(tx.value) / 10 ** Number(decimals || 6)).toString(),
    confirmedAt: tx.timeStamp ? new Date(Number(tx.timeStamp) * 1000).toISOString() : null,
    confirmed: Number(tx.confirmations ?? 0) > 0,
    raw: tx,
  }));
}

function formatTronList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((tx, index) => ({
    chain: 'TRC20',
    txHash: String(tx.transaction_id || tx.transactionId || tx.transactionHash || ''),
    logIndex: Number(tx.event_index ?? tx.eventIndex ?? index ?? 0),
    blockNumber: Number(tx.block ?? tx.block_number ?? 0),
    confirmations: tx.confirmed ? 1 : Number(tx.confirmations ?? 0),
    fromAddress: tx.from || tx.transferFromAddress,
    toAddress: tx.to || tx.transferToAddress,
    amount: (
      Number(tx.value ?? tx.amount ?? tx.quant ?? 0) / 1e6
    ).toString(),
    confirmedAt: tx.block_timestamp
      ? new Date(Number(tx.block_timestamp)).toISOString()
      : tx.timestamp
        ? new Date(Number(tx.timestamp)).toISOString()
        : null,
    confirmed: tx.confirmed === undefined ? true : Boolean(tx.confirmed),
    raw: tx,
  }));
}

function matchesTronContract(tx, contractAddress) {
  const expected = String(contractAddress || '').trim().toLowerCase();
  if (!expected) return true;

  const candidates = [
    tx?.tokenInfo?.tokenId,
    tx?.tokenInfo?.address,
    tx?.trc20Id,
    tx?.contract_address,
    tx?.contractAddress,
    tx?.tokenId,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return candidates.length === 0 ? true : candidates.includes(expected);
}

function normalizePagingWindow({ start, limit, defaultLimit, maxLimit }) {
  const parsedStart = Number.isFinite(Number(start)) ? parseInt(start, 10) : 0;
  const parsedLimit = Number.isFinite(Number(limit)) ? parseInt(limit, 10) : defaultLimit;
  return {
    start: parsedStart >= 0 ? parsedStart : 0,
    limit: Math.min(parsedLimit > 0 ? parsedLimit : defaultLimit, maxLimit),
  };
}

function parseExplorerListPayload(payload) {
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.token_transfers)) return payload.token_transfers;
  if (Array.isArray(payload?.transfers)) return payload.transfers;
  if (Array.isArray(payload?.data?.token_transfers)) return payload.data.token_transfers;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function detectTronEnvironment(assetConfig) {
  const fullHost = String(resolveTronExplorerBaseUrl(assetConfig) || '').toLowerCase();
  if (fullHost.includes('nile')) return 'NILE';
  return 'MAINNET';
}

function isTronGridHost(baseUrl) {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  return normalized.includes('trongrid.io');
}

function isTronScanHost(baseUrl) {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  return normalized.includes('tronscanapi.com');
}

async function fetchAllEvmTokenTransfers({ address, assetConfig, apiBase, apiKey, chainId, label }) {
  const urls = buildScanApiUrls(apiBase);
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= EVM_PAGE_LIMIT; page += 1) {
    const params = {
      chainid: String(chainId),
      module: 'account',
      action: 'tokentx',
      contractaddress: assetConfig.contractAddress,
      address,
      page,
      offset: EVM_PAGE_SIZE,
      sort: 'desc',
      apikey: apiKey,
    };

    const res = await getScanWithFallback({ urls, params, label });
    const pageItems = parseExplorerListPayload(res.data);
    if (!Array.isArray(pageItems) || pageItems.length === 0) break;

    let added = 0;
    for (const item of pageItems) {
      const uniqueKey = `${item.hash || ''}:${item.logIndex ?? item.transactionIndex ?? 0}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      all.push(item);
      added += 1;
    }

    if (pageItems.length < EVM_PAGE_SIZE || added === 0) break;
  }

  return formatEvmList(all, assetConfig.decimals, assetConfig.network);
}

async function fetchAllTronGridTransfers({ address, contractAddress, apiBase, apiKey }) {
  const all = [];
  const seen = new Set();
  let fingerprint;
  const log = tronLogger.child({ job: 'explorer_sync' });  
  while (true) {
    const params = {
      limit: TRON_GRID_PAGE_SIZE,
      contract_address: contractAddress || undefined,
      only_confirmed: true,
      fingerprint: fingerprint || undefined,
    };
    const res = await axios.get(
      `${apiBase.replace(/\/+$/, '')}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`,
      {
        ...AXIOS_DIRECT_REQUEST,
        headers: {
          'TRON-PRO-API-KEY': apiKey,
        },
        params,
      }
    );

    // console.log('Fetched_tron_grid_page', {}, res?.data);

    log.debug(
      {
        event: 'sync_page_fetched',
        network: 'tron',
        pageType: 'trongrid_trc20',
        depositAddress: address,
        contractAddress,
        itemCount: Array.isArray(res?.data?.data) ? res.data.data.length : 0,
        cursor: fingerprint || null,
      },
      'sync_page_fetched'
    );

    const transfers = Array.isArray(res?.data?.data) ? res.data.data : [];
    if (transfers.length === 0) break;

    let added = 0;
    for (const item of transfers) {
      const uniqueKey = `${item.transaction_id || item.transactionHash || item.transactionId || ''}:${item.event_index ?? item.eventIndex ?? added}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      all.push(item);
      added += 1;
    }

    fingerprint = res?.data?.meta?.fingerprint || null;
    if (!fingerprint || added === 0 || transfers.length < TRON_GRID_PAGE_SIZE) break;
  }

  return formatTronList(all.filter((tx) => matchesTronContract(tx, contractAddress)));
}

async function fetchAllTronScanTransfers({ address, contractAddress, apiBase, apiKey }) {
  const all = [];
  const seen = new Set();
  const log = tronLogger.child({ job: 'explorer_sync' });

  for (let page = 0; page < TRON_SCAN_PAGE_LIMIT; page += 1) {
    const paging = normalizePagingWindow({
      start: page * TRON_SCAN_PAGE_SIZE,
      limit: TRON_SCAN_PAGE_SIZE,
      defaultLimit: TRON_SCAN_PAGE_SIZE,
      maxLimit: TRON_SCAN_PAGE_SIZE,
    });    

    const res = await axios.get(`${apiBase.replace(/\/+$/, '')}/api/token_trc20/transfers-with-status`, {
      ...AXIOS_DIRECT_REQUEST,
      headers: {
        'TRON-PRO-API-KEY': apiKey,
      },
      params: {
        trc20Id: contractAddress,
        address,
        // limit: paging.limit,
        // start: paging.start,
        direction: 0,
        reverse: true,
        db_version: 1,
      },
    });

    log.debug(
      {
        event: 'sync_page_fetched',
        network: 'tron',
        pageType: 'tronscan_trc20',
        depositAddress: address,
        contractAddress,
        page,
        itemCount: Array.isArray(res?.data?.data) ? res.data.data.length : 0,
      },
      'sync_page_fetched'
    );

    const transfers = Array.isArray(res?.data?.data)
      ? res.data.data.filter((tx) => matchesTronContract(tx, contractAddress))
      : [];
    if (transfers.length === 0) break;

    let added = 0;
    for (const item of transfers) {
      const uniqueKey = `${item.hash || item.transaction_id || item.transactionHash || item.transactionId || ''}:${item.event_index ?? item.eventIndex ?? added}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      all.push(item);
      added += 1;
    }

    if (transfers.length < paging.limit || added === 0) break;
  }

  return formatTronList(all);
}

async function getAllTronContractEvents(tronWeb, contractAddress) {
  const allEvents = [];
  let fingerprint;
  let pages = 0;

  do {
    const response = await tronWeb.event.getEventsByContractAddress(contractAddress, {
      eventName: 'Transfer',
      onlyConfirmed: true,
      orderBy: 'block_timestamp,desc',
      limit: TRON_EVENT_PAGE_SIZE,
      fingerprint,
    });

    const events = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response)
        ? response
        : [];

    allEvents.push(...events);
    fingerprint = response?.meta?.fingerprint || response?.fingerprint || null;
    pages += 1;
  } while (fingerprint && pages < TRON_EVENT_PAGE_LIMIT);

  return allEvents;
}

async function getExplorerTransactions(address, assetConfig) {
  const network = String(assetConfig.network || '').trim().toUpperCase();
  const contractAddress = requireExplorerConfig(
    assetConfig.contractAddress,
    'EXPLORER_CONTRACT_NOT_CONFIGURED'
  );

  if (network === 'ERC20') {
    const apiBase = requireExplorerConfig(resolveEvmExplorerBaseUrl(network, assetConfig), 'ETH_API_URL_NOT_CONFIGURED');
    const apiKey = resolveExplorerApiKey('ETH_API_TOKEN');
    return fetchAllEvmTokenTransfers({
      address,
      assetConfig,
      apiBase,
      apiKey,
      chainId: assetConfig.chainId || 1,
      label: 'ERC20 tokentx',
    });
  }

  if (network === 'BEP20') {
    const apiBase = requireExplorerConfig(resolveEvmExplorerBaseUrl(network, assetConfig), 'BSC_API_URL_NOT_CONFIGURED');
    const apiKey = resolveExplorerApiKey('BSC_API_TOKEN');
    return fetchAllEvmTokenTransfers({
      address,
      assetConfig,
      apiBase,
      apiKey,
      chainId: assetConfig.chainId || 56,
      label: 'BEP20 tokentx',
    });
  }


  if (network === 'TRC20') {
    const apiBase = requireExplorerConfig(resolveTronExplorerBaseUrl(assetConfig), 'TRX_API_URL_NOT_CONFIGURED');
    const apiKey = resolveExplorerApiKey('TRX_API_TOKEN');

    if (isTronGridHost(apiBase)) {
      return fetchAllTronGridTransfers({ address, contractAddress, apiBase, apiKey });
    }

    if (isTronScanHost(apiBase)) {
      return fetchAllTronScanTransfers({ address, contractAddress, apiBase, apiKey });
    }

    const tronWeb = buildTronWeb(assetConfig);
    const events = await getAllTronContractEvents(tronWeb, contractAddress);
    return formatTronList(events);
  }

  const err = new Error('INVALID_NETWORK');
  err.status = 400;
  throw err;
}

export async function getExplorerTransactionsForAddress(address, network) {
  const normalizedNetwork = String(network || '').trim().toUpperCase();
  const assetConfig = await getSignalAssetByNetwork(normalizedNetwork);
  if (!assetConfig || !assetConfig.isEnabled) {
    const err = new Error('NETWORK_NOT_SUPPORTED');
    err.status = 400;
    throw err;
  }
  return getExplorerTransactions(address, assetConfig);
}

export async function syncExplorerDepositsForUser(userId, network) {
  const normalizedNetwork = String(network || '').trim().toUpperCase();
  const log = getExplorerLogger(normalizedNetwork).child({ module: 'deposit', job: 'explorer_sync', userId });
  const [wallet, assetConfig] = await Promise.all([
    getUserWalletByNetwork(userId, normalizedNetwork),
    getSignalAssetByNetwork(normalizedNetwork),
  ]);

  if (!wallet) {
    const err = new Error('USER_WALLET_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  if (!assetConfig || !assetConfig.isEnabled) {
    const err = new Error('NETWORK_NOT_SUPPORTED');
    err.status = 400;
    throw err;
  }

  const address = normalizeAddress(normalizedNetwork, wallet.address);
  const requiredConfirmations = Number(assetConfig.confirmations || 0);
  const transactions = await getExplorerTransactions(wallet.address, assetConfig);
  const tronEnvironment = normalizedNetwork === 'TRC20' ? detectTronEnvironment(assetConfig) : null;

  let synced = 0;
  let skipped = 0;

  log.info({ event: 'sync_started', network: normalizedNetwork, depositAddress: wallet.address }, 'sync_started');

  for (const tx of transactions) {
    if (!tx.txHash) {
      skipped += 1;
      continue;
    }
    const toAddress = normalizeAddress(normalizedNetwork, tx.toAddress);
    if (!toAddress || toAddress !== address) {
      skipped += 1;
      continue;
    }
    if (!tx.confirmed) {
      skipped += 1;
      continue;
    }
    if (requiredConfirmations > 0 && Number(tx.confirmations || 0) > 0 && Number(tx.confirmations || 0) < requiredConfirmations) {
      skipped += 1;
      continue;
    }

    const saved = await saveDepositAndCredit({
      userId,
      chain: normalizedNetwork,
      asset: assetConfig.asset,
      txHash: tx.txHash,
      amount: tx.amount,
      blockNumber: tx.blockNumber || null,
      confirmations: tx.confirmations || requiredConfirmations || 0,
      logIndex: tx.logIndex || 0,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      meta: {
        source: 'explorer_refresh',
        contractAddress: assetConfig.contractAddress,
        confirmedAt: tx.confirmedAt,
        explorerNetwork: tronEnvironment,
        explorerApiBase:
          normalizedNetwork === 'ERC20'
            ? resolveEvmExplorerBaseUrl(normalizedNetwork, assetConfig)
            : normalizedNetwork === 'BEP20'
              ? resolveEvmExplorerBaseUrl(normalizedNetwork, assetConfig)
              : resolveTronExplorerBaseUrl(assetConfig),
      },
    });
    if (saved) {
      synced += 1;
      log.info({
        event: 'deposit_credited',
        network: normalizedNetwork,
        token: assetConfig.asset?.toLowerCase(),
        txHash: tx.txHash,
        blockNumber: tx.blockNumber || null,
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        amount: tx.amount,
        confirmationCount: tx.confirmations || requiredConfirmations || 0,
        depositAddress: wallet.address,
        userId,
      }, 'deposit_credited');
    } else {
      skipped += 1;
      log.warn({
        event: 'deposit_ignored',
        network: normalizedNetwork,
        txHash: tx.txHash,
        depositAddress: wallet.address,
        reason: 'DUPLICATE_OR_SKIPPED',
      }, 'deposit_ignored');
    }
  }

  log.info({ event: 'sync_completed', network: normalizedNetwork, depositAddress: wallet.address, synced, skipped }, 'sync_completed');

  return {
    network: normalizedNetwork,
    address: wallet.address,
    synced,
    skipped,
  };
}

export async function listStoredDepositHistory(userId, { limit = 25, network } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 100);
  const query = db('deposits').where({ user_id: userId });
  if (network) query.andWhere({ chain: String(network).trim().toUpperCase() });
  const rows = await query.orderBy('created_at', 'desc').limit(safeLimit);
  return rows.map(mapStoredDeposit);
}
