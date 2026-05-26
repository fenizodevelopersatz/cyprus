import { JsonRpcProvider } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getModuleLogger } from '../logging/loggers.js';

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
  const provider = new JsonRpcProvider(rpcUrl);
  const maskedRpcUrl = maskRpcUrl(rpcUrl);

  try {
    const detectedNetwork = await provider.getNetwork();
    logger.info(
      {
        event: 'rpc_connected',
        service,
        network,
        rpcUrl: maskedRpcUrl,
        chainId: normalizeChainId(detectedNetwork?.chainId),
        detectedNetworkName: detectedNetwork?.name || null,
        ...extra,
      },
      'rpc_connected'
    );
    return provider;
  } catch (err) {
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
        ...extra,
      },
      'rpc_startup_failed'
    );
    throw err;
  }
}

export { RPC_ERROR_LOG_PATH };
