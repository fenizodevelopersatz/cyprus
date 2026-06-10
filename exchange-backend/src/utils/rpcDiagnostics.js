import { JsonRpcProvider } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getModuleLogger } from '../logging/loggers.js';
import {
  recordBlockchainConnectionIssue,
  recordBlockchainConnectionTransaction,
} from '../services/backendUrlManager.service.js';
import { orderRuntimeRpcUrlsForUse, recordRpcStatus } from './rpcPool.js';

const rpcLogger = getModuleLogger('rpc');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const RPC_ERROR_LOG_PATH = path.join(LOG_DIR, 'rpc-errors.log');

function maskRpcUrl(rpcUrl) {
  const raw = String(rpcUrl || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.password) url.password = '[REDACTED]';
    if (url.username) url.username = '[REDACTED]';
    if (url.searchParams.has('apikey')) url.searchParams.set('apikey', '[REDACTED]');
    if (url.searchParams.has('apiKey')) url.searchParams.set('apiKey', '[REDACTED]');
    if (url.searchParams.has('token')) url.searchParams.set('token', '[REDACTED]');
    return url.toString();
  } catch {
    return raw;
  }
}

function normalizeChainId(chainId) {
  if (chainId === undefined || chainId === null) return null;
  try {
    return String(chainId);
  } catch {
    return null;
  }
}

function ensureRpcLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function appendRpcErrorLog(entry) {
  try {
    ensureRpcLogDir();
    fs.appendFileSync(RPC_ERROR_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Avoid breaking the caller if file logging fails.
  }
}

export async function createLoggedRpcProvider({
  rpcUrl,
  network,
  service,
  logger = rpcLogger,
  extra = {},
}) {
  const rpcUrls = orderRuntimeRpcUrlsForUse({ rpcUrl, network });
  if (rpcUrls.length === 0) {
    throw new Error('RPC_URL_NOT_CONFIGURED');
  }

  let lastError = null;

  for (const candidateRpcUrl of rpcUrls) {
    const provider = new JsonRpcProvider(candidateRpcUrl);
    const maskedRpcUrl = maskRpcUrl(candidateRpcUrl);
    const startedAt = Date.now();

    try {
      const detectedNetwork = await provider.getNetwork();
      const chainId = normalizeChainId(detectedNetwork?.chainId);
      const latencyMs = Date.now() - startedAt;
      recordRpcStatus({ network, rpcUrl: candidateRpcUrl, ok: true, service, latencyMs, chainId });
      logger.info(
        {
          event: 'rpc_connected',
          service,
          network,
          rpcUrl: maskedRpcUrl,
          chainId,
          detectedNetworkName: detectedNetwork?.name || null,
          latencyMs,
          ...extra,
        },
        'rpc_connected'
      );
      recordBlockchainConnectionTransaction('rpc_connected', {
        service,
        network,
        rpcUrl: maskedRpcUrl,
        chainId,
        extra,
      });
      return provider;
    } catch (err) {
      lastError = err;
      recordRpcStatus({ network, rpcUrl: candidateRpcUrl, ok: false, service, latencyMs: Date.now() - startedAt, error: err });
      appendRpcErrorLog({
        timestamp: new Date().toISOString(),
        event: 'rpc_startup_failed',
        service,
        network,
        rpcUrl: maskedRpcUrl,
        ...extra,
        error: {
          message: String(err?.message || err || 'RPC_STARTUP_FAILED'),
          code: err?.code || null,
          shortMessage: err?.shortMessage || null,
        },
      });
      logger.error(
        {
          err,
          event: 'rpc_startup_failed',
          service,
          network,
          rpcUrl: maskedRpcUrl,
          remainingRpcUrls: rpcUrls.length - rpcUrls.indexOf(candidateRpcUrl) - 1,
          ...extra,
        },
        'rpc_startup_failed'
      );
      recordBlockchainConnectionIssue('rpc_startup_failed', {
        service,
        network,
        rpcUrl: maskedRpcUrl,
        extra,
        error: err,
      });
    }
  }

  throw lastError || new Error('RPC_STARTUP_FAILED');
}

export { RPC_ERROR_LOG_PATH };
