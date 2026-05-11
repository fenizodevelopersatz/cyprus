import { Interface, JsonRpcProvider, formatUnits, id } from 'ethers';
import { db } from '../db.js';
import {
  creditConfirmedDeposit,
  getRequiredConfirmations,
  normalizeDepositAddress,
  updateScanCursor,
  upsertDetectedDeposit,
} from './fundingDepositService.js';
import { bscLogger, cronLogger, depositLogger, ethereumLogger, tronLogger } from '../logging/loggers.js';
import { getTronClient } from '../utils/tron.js';

const ERC20_TRANSFER_TOPIC = id('Transfer(address,address,uint256)');
const ERC20_INTERFACE = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.DEPOSIT_MONITOR_INTERVAL_MS || 15000);
const DEFAULT_EVM_CHUNK_SIZE = Number(process.env.DEPOSIT_MONITOR_EVM_CHUNK_SIZE || 200);
const DEFAULT_TRON_EVENT_SIZE = Number(process.env.DEPOSIT_MONITOR_TRON_EVENT_SIZE || 200);
const SAFE_START_BLOCK_LOOKBACK = Number(process.env.DEPOSIT_MONITOR_START_LOOKBACK || 500);
const DEFAULT_EVM_REQUEST_DELAY_MS = Number(process.env.DEPOSIT_MONITOR_EVM_REQUEST_DELAY_MS || 300);
const EVM_RATE_LIMIT_BACKOFF_MS = Number(process.env.DEPOSIT_MONITOR_EVM_BACKOFF_MS || 3000);
const DEFAULT_EVM_GET_LOGS_RETRIES = Number(process.env.DEPOSIT_MONITOR_EVM_GET_LOGS_RETRIES || 3);

function getNetworkLogger(network) {
  if (network === 'ethereum') return ethereumLogger;
  if (network === 'bsc') return bscLogger;
  if (network === 'tron') return tronLogger;
  return depositLogger;
}

function buildBlockchainLogFields(config, payload, userId = null) {
  return {
    network: config.network,
    token: payload.token || 'usdt',
    txHash: payload.txHash,
    blockNumber: payload.blockNumber,
    fromAddress: payload.fromAddress,
    toAddress: payload.toAddress,
    amount: payload.amount,
    confirmationCount: payload.confirmations,
    depositAddress: payload.toAddress,
    userId,
  };
}

const NETWORK_CONFIGS = [
  {
    network: 'ethereum',
    walletNetwork: 'ERC20',
    rpcUrl: process.env.ETH_RPC_URL,
    contractAddress: process.env.USDT_ETH_CONTRACT,
    decimals: 6,
    confirmations: getRequiredConfirmations('ethereum'),
    networkType: 'EVM',
  },
  {
    network: 'bsc',
    walletNetwork: 'BEP20',
    rpcUrl: process.env.BSC_RPC_URL,
    contractAddress: process.env.USDT_BSC_CONTRACT,
    decimals: 18,
    confirmations: getRequiredConfirmations('bsc'),
    networkType: 'EVM',
  },
  {
    network: 'tron',
    walletNetwork: 'TRC20',
    contractAddress: process.env.USDT_TRON_CONTRACT,
    fullHost: process.env.TRX_API_URL,
    decimals: 6,
    confirmations: getRequiredConfirmations('tron'),
    networkType: 'TRON',
  },
];

async function getAddressMap(walletNetwork) {
  const rows = await db('user_wallets')
    .where({ network: walletNetwork })
    .select('user_id', 'network', 'address');
  return new Map(
    rows.map((row) => [
      normalizeDepositAddress(walletNetwork === 'TRC20' ? 'tron' : walletNetwork === 'BEP20' ? 'bsc' : 'ethereum', row.address),
      row.user_id,
    ])
  );
}

async function getOrCreateScanState(walletNetwork, currentBlock = 0) {
  let row = await db('deposit_scan_state').where({ network: walletNetwork }).first();
  if (row) return row;
  const seededBlock = Math.max(0, Number(currentBlock || 0) - SAFE_START_BLOCK_LOOKBACK);
  const now = new Date();
  await db('deposit_scan_state').insert({
    network: walletNetwork,
    last_processed_block: seededBlock,
    created_at: now,
    updated_at: now,
    last_synced_at: now,
  });
  return db('deposit_scan_state').where({ network: walletNetwork }).first();
}

function isEvmLogLimitError(err) {
  const message = String(err?.error?.message || err?.shortMessage || err?.message || '').toLowerCase();
  return message.includes('more than 10000 results') || message.includes('eth_getlogs');
}

function isEvmRateLimitError(err) {
  const message = String(err?.error?.message || err?.shortMessage || err?.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests');
}

function getSuggestedToBlock(err) {
  const suggested = err?.error?.data?.to;
  if (typeof suggested === 'string') {
    const parsed = Number.parseInt(suggested, 16);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof suggested === 'number' && Number.isFinite(suggested)) return suggested;
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeGetLogs(provider, params, retries = DEFAULT_EVM_GET_LOGS_RETRIES) {
  try {
    return await provider.getLogs(params);
  } catch (err) {
    if (retries <= 0 || (!isEvmRateLimitError(err) && !isEvmLogLimitError(err))) throw err;
    await sleep(EVM_RATE_LIMIT_BACKOFF_MS);
    return safeGetLogs(provider, params, retries - 1);
  }
}

async function processDetectedDeposit(payload) {
  const networkLogger = getNetworkLogger(payload.network);
  const result = await upsertDetectedDeposit(payload);
  if (result?.ignored) {
    networkLogger.warn(
      {
        event: 'deposit_ignored',
        ...buildBlockchainLogFields({ network: payload.network }, payload),
        reason: result.reason,
      },
      'deposit_ignored'
    );
    return result;
  }

  networkLogger.info(
    {
      event: 'deposit_detected',
      ...buildBlockchainLogFields({ network: payload.network }, payload, result?.userId || payload.userId || null),
      status: result?.status,
      depositId: result?.depositId,
    },
    'deposit_detected'
  );

  if (result?.status === 'confirmed') {
    networkLogger.info(
      {
        event: 'deposit_confirmed',
        ...buildBlockchainLogFields({ network: payload.network }, payload, result?.userId || payload.userId || null),
        depositId: result.depositId,
      },
      'deposit_confirmed'
    );
  }

  if (result?.depositId && result.status === 'confirmed') {
    await creditConfirmedDeposit(result.depositId);
    networkLogger.info(
      {
        event: 'deposit_credited',
        ...buildBlockchainLogFields({ network: payload.network }, payload, result?.userId || payload.userId || null),
        depositId: result.depositId,
      },
      'deposit_credited'
    );
  }
  return result;
}

async function pollEvmDeposits(config) {
  const networkLogger = getNetworkLogger(config.network);
  const provider = new JsonRpcProvider(config.rpcUrl);
  const latestBlock = await provider.getBlockNumber();
  const scanState = await getOrCreateScanState(config.walletNetwork, latestBlock);
  const watchedAddresses = await getAddressMap(config.walletNetwork);
  const safeStart = Number(scanState.last_processed_block || 0) + 1;
  if (watchedAddresses.size === 0) {
    await updateScanCursor(config.network, { lastProcessedBlock: latestBlock });
    return;
  }

  let fromBlock = safeStart;
  let chunkSize = DEFAULT_EVM_CHUNK_SIZE;

  while (fromBlock <= latestBlock) {
    let toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
    let logs;

    try {
      logs = await safeGetLogs(provider, {
        address: config.contractAddress,
        fromBlock,
        toBlock,
        topics: [ERC20_TRANSFER_TOPIC],
      });
    } catch (err) {
      if (isEvmRateLimitError(err)) {
        chunkSize = Math.max(10, Math.floor(chunkSize / 2));
        await sleep(EVM_RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      if (!isEvmLogLimitError(err)) throw err;
      const suggestedToBlock = getSuggestedToBlock(err);
      if (suggestedToBlock !== null && suggestedToBlock >= fromBlock && suggestedToBlock < toBlock) {
        toBlock = Math.min(suggestedToBlock, latestBlock);
        logs = await safeGetLogs(provider, {
          address: config.contractAddress,
          fromBlock,
          toBlock,
          topics: [ERC20_TRANSFER_TOPIC],
        });
      } else if (chunkSize > 10) {
        chunkSize = Math.max(10, Math.floor(chunkSize / 2));
        continue;
      } else {
        throw err;
      }
    }

    networkLogger.info(
      {
        event: 'sync_page_fetched',
        network: config.network,
        pageType: 'block_range',
        fromBlock,
        toBlock,
        itemCount: logs.length,
      },
      'sync_page_fetched'
    );

    for (const log of logs) {
      const parsed = ERC20_INTERFACE.parseLog(log);
      const to = normalizeDepositAddress(config.network, parsed.args.to);
      if (!watchedAddresses.has(to)) continue;
      const confirmations = latestBlock - Number(log.blockNumber || 0) + 1;
      await processDetectedDeposit({
        network: config.network,
        token: 'usdt',
        contractAddress: config.contractAddress,
        txHash: log.transactionHash,
        logIndex: log.index,
        amount: formatUnits(parsed.args.value, config.decimals),
        fromAddress: normalizeDepositAddress(config.network, parsed.args.from),
        toAddress: to,
        blockNumber: log.blockNumber,
        confirmations,
        confirmationTarget: config.confirmations,
        rawPayload: log,
        source: 'worker',
        confirmedAt: confirmations >= config.confirmations ? new Date().toISOString() : null,
      });
    }

    await updateScanCursor(config.network, { lastProcessedBlock: toBlock });
    fromBlock = toBlock + 1;
    await sleep(DEFAULT_EVM_REQUEST_DELAY_MS);
  }
}

async function pollTronDeposits(config) {
  const networkLogger = getNetworkLogger(config.network);
  const tronWeb = getTronClient({ fullHost: config.fullHost });
  const currentBlock = await tronWeb.trx.getCurrentBlock();
  const latestBlock = Number(currentBlock?.block_header?.raw_data?.number || 0);
  const scanState = await getOrCreateScanState(config.walletNetwork, latestBlock);
  const watchedAddresses = await getAddressMap(config.walletNetwork);
  if (watchedAddresses.size === 0) {
    await updateScanCursor(config.network, { lastProcessedBlock: latestBlock });
    return;
  }

  let fromBlock = Number(scanState.last_processed_block || 0) + 1;
  while (fromBlock <= latestBlock) {
    let fingerprint;
    do {
      const response = await tronWeb.event.getEventsByContractAddress(config.contractAddress, {
        eventName: 'Transfer',
        onlyConfirmed: false,
        limit: DEFAULT_TRON_EVENT_SIZE,
        blockNumber: fromBlock,
        fingerprint,
        orderBy: 'block_timestamp,asc',
      });

      const events = Array.isArray(response?.data) ? response.data : [];
      networkLogger.info(
        {
          event: 'sync_page_fetched',
          network: config.network,
          pageType: 'tron_events',
          blockNumber: fromBlock,
          itemCount: events.length,
          cursor: fingerprint || null,
        },
        'sync_page_fetched'
      );
      for (const event of events) {
        const to = normalizeDepositAddress(config.network, event.result?.to);
        if (!watchedAddresses.has(to)) continue;
        const blockNumber = Number(event.block_number || fromBlock);
        const confirmations = latestBlock - blockNumber + 1;
        const rawValue = event.result?.value;
        await processDetectedDeposit({
          network: config.network,
          token: 'usdt',
          contractAddress: config.contractAddress,
          txHash: event.transaction_id || event.transaction,
          logIndex: Number(event.event_index || 0),
          amount: (Number(rawValue) / 10 ** config.decimals).toString(),
          fromAddress: normalizeDepositAddress(config.network, event.result?.from),
          toAddress: to,
          blockNumber,
          confirmations,
          confirmationTarget: config.confirmations,
          rawPayload: event,
          source: 'worker',
          confirmedAt: confirmations >= config.confirmations ? new Date().toISOString() : null,
        });
      }
      fingerprint = response?.meta?.fingerprint || response?.fingerprint || null;
    } while (fingerprint);

    await updateScanCursor(config.network, { lastProcessedBlock: fromBlock });
    fromBlock += 1;
  }
}

async function runPollCycle() {
  for (const config of NETWORK_CONFIGS) {
    const networkLogger = getNetworkLogger(config.network);
    if (!config.contractAddress) {
      networkLogger.warn(
        { event: 'deposit_ignored', network: config.network, reason: 'CONTRACT_NOT_CONFIGURED' },
        'network_skipped'
      );
      continue;
    }

    try {
      cronLogger.info({ event: 'sync_started', job: 'deposit_monitor', network: config.network }, 'sync_started');
      if (config.networkType === 'TRON') {
        await pollTronDeposits(config);
      } else if (config.rpcUrl) {
        await pollEvmDeposits(config);
      }
      cronLogger.info({ event: 'sync_completed', job: 'deposit_monitor', network: config.network }, 'sync_completed');
    } catch (err) {
      networkLogger.error(
        { err, event: 'sync_failed', job: 'deposit_monitor', network: config.network },
        'sync_failed'
      );
    }
  }
}

export function startDepositMonitor() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPollCycle();
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, DEFAULT_POLL_INTERVAL_MS);
}
