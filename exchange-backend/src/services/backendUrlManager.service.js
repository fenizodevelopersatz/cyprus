import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cfg } from '../config.js';
import { getModuleLogger } from '../logging/loggers.js';
import { discoverApiEndpoints } from './apiEndpointDiscovery.service.js';
import { getNetworkModeSummary, pickEnvByMode } from '../utils/networkMode.js';
import { parseRpcUrls, recordRpcStatus } from '../utils/rpcPool.js';

const logger = getModuleLogger('backend_url_manager');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.resolve(APP_ROOT, 'storage');
const DEFAULT_CONFIG_PATH = path.join(STORAGE_DIR, 'backend-url-registry.json');
const DEFAULT_TRANSACTION_LOG_PATH = path.join(STORAGE_DIR, 'backend-url-transactions.jsonl');
const DEFAULT_ISSUE_LOG_PATH = path.join(STORAGE_DIR, 'backend-url-issues.jsonl');

const CONFIG_PATH = path.resolve(cfg.urlManager.configPath || DEFAULT_CONFIG_PATH);
const TRANSACTION_LOG_PATH = path.resolve(cfg.urlManager.transactionLogPath || DEFAULT_TRANSACTION_LOG_PATH);
const ISSUE_LOG_PATH = path.resolve(cfg.urlManager.issueLogPath || DEFAULT_ISSUE_LOG_PATH);
const cache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function ensureStorageDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function maskUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of ['apikey', 'apiKey', 'token', 'key', 'secret']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() !== 'false';
}

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createEndpoint(input, source = 'json') {
  const url = String(input?.url || '').trim();
  const key = normalizeKey(input?.key || input?.name || input?.label || input?.network || url);
  if (!key || !url) return null;

  return {
    key,
    label: String(input?.label || input?.name || key).trim(),
    url,
    maskedUrl: maskUrl(url),
    type: String(input?.type || 'backend').trim().toLowerCase(),
    network: input?.network ? normalizeKey(input.network) : null,
    enabled: parseBoolean(input?.enabled, true),
    checkMethod: String(input?.checkMethod || input?.method || 'auto').trim().toLowerCase(),
    timeoutMs: safeNumber(input?.timeoutMs, cfg.urlManager.timeoutMs),
    cacheTtlMs: safeNumber(input?.cacheTtlMs, cfg.urlManager.cacheTtlMs),
    source,
    createdAt: input?.createdAt || nowIso(),
    updatedAt: input?.updatedAt || nowIso(),
    lastStatus: input?.lastStatus || null,
  };
}

function createRpcEndpoints(input, source = 'env_default') {
  const urls = parseRpcUrls(input?.url);
  if (urls.length <= 1) {
    const endpoint = createEndpoint(input, source);
    return endpoint ? [endpoint] : [];
  }

  return urls
    .map((url, index) =>
      createEndpoint(
        {
          ...input,
          key: `${input.key}_${index + 1}`,
          label: `${input.label || input.key} #${index + 1}`,
          url,
        },
        source
      )
    )
    .filter(Boolean);
}

function parseEnvEndpoints() {
  const endpoints = [];
  const raw = String(process.env.BACKEND_URLS || process.env.URL_MANAGER_URLS || '').trim();

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed).map(([key, value]) => (typeof value === 'string' ? { key, url: value } : { key, ...value }));
      for (const item of items) {
        const endpoint = createEndpoint(item, 'env');
        if (endpoint) endpoints.push(endpoint);
      }
    } catch {
      for (const part of raw.split(',')) {
        const url = part.trim();
        const endpoint = createEndpoint({ url, type: 'backend' }, 'env');
        if (endpoint) endpoints.push(endpoint);
      }
    }
  }

  const defaults = [
    { key: 'api_base', label: 'API Base URL', url: cfg.api.baseUrl, type: 'backend' },
    { key: 'app_base', label: 'App Base URL', url: cfg.ui.appBaseUrl, type: 'frontend' },
    { key: 'network_mode', label: `Network Mode: ${getNetworkModeSummary().mode}`, url: cfg.api.baseUrl, type: 'config' },
    { key: 'ethereum_rpc', label: 'Ethereum RPC', url: pickEnvByMode({ mainnet: ['ETH_RPC_MAINNET', 'ETH_MAINNET_RPC_URL'], testnet: ['ETH_RPC_TESTNET', 'ETH_SEPOLIA_RPC_URL', 'ETH_GOERLI_RPC_URL'], devnet: ['ETH_RPC_DEVNET', 'ETH_SEPOLIA_RPC_URL'] }, ['ETH_RPC_URL', 'ETH_RPC_HTTP']), type: 'blockchain_rpc', network: 'ethereum' },
    { key: 'bsc_rpc', label: 'BSC RPC', url: pickEnvByMode({ mainnet: ['BSC_RPC_MAINNET', 'BSC_MAINNET_RPC_URL'], testnet: ['BSC_RPC_TESTNET', 'BSC_TESTNET_RPC_URL'], devnet: ['BSC_RPC_TESTNET', 'BSC_TESTNET_RPC_URL'] }, ['BSC_RPC_URL', 'BSC_RPC_HTTP']), type: 'blockchain_rpc', network: 'bsc' },
    { key: 'tron_rpc', label: 'TRON RPC', url: pickEnvByMode({ mainnet: ['TRX_API_MAINNET', 'TRON_MAINNET_FULL_HOST'], testnet: ['TRX_API_NILE', 'TRON_NILE_FULL_HOST', 'TRX_API_TESTNET'], devnet: ['TRX_API_NILE', 'TRON_NILE_FULL_HOST', 'TRX_API_TESTNET'] }, ['TRX_API_URL', 'TRON_FULL_HOST', 'TRON_API_BASE']), type: 'blockchain_rpc', network: 'tron' },
    { key: 'solana_rpc', label: 'Solana RPC', url: process.env.SOLANA_RPC_URL || process.env.SOLANA_DEVNET_RPC, type: 'blockchain_rpc', network: 'solana' },
  ];

  for (const item of defaults) {
    const candidates =
      item.type === 'blockchain_rpc'
        ? createRpcEndpoints({ ...item, enabled: Boolean(item.url) }, 'env_default')
        : [createEndpoint({ ...item, enabled: Boolean(item.url) }, 'env_default')].filter(Boolean);
    endpoints.push(...candidates);
  }

  return endpoints;
}

function readRegistry() {
  const envEndpoints = parseEnvEndpoints();
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      version: 1,
      enabled: cfg.urlManager.enabled,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      endpoints: envEndpoints,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const stored = Array.isArray(parsed?.endpoints) ? parsed.endpoints.map((item) => createEndpoint(item, item.source || 'json')).filter(Boolean) : [];
    const byKey = new Map(envEndpoints.map((item) => [item.key, item]));
    for (const item of stored) byKey.set(item.key, { ...byKey.get(item.key), ...item, maskedUrl: maskUrl(item.url) });
    return {
      version: 1,
      enabled: parsed?.enabled ?? cfg.urlManager.enabled,
      createdAt: parsed?.createdAt || nowIso(),
      updatedAt: parsed?.updatedAt || nowIso(),
      endpoints: Array.from(byKey.values()),
    };
  } catch (err) {
    logger.error({ err, path: CONFIG_PATH }, 'backend_url_registry_read_failed');
    return {
      version: 1,
      enabled: cfg.urlManager.enabled,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      endpoints: envEndpoints,
    };
  }
}

function writeRegistry(registry) {
  ensureStorageDir(CONFIG_PATH);
  const payload = {
    ...registry,
    updatedAt: nowIso(),
    endpoints: registry.endpoints.map((endpoint) => ({
      ...endpoint,
      maskedUrl: maskUrl(endpoint.url),
    })),
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function appendJsonLine(filePath, entry) {
  try {
    ensureStorageDir(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    logger.error({ err, path: filePath }, 'backend_url_log_write_failed');
  }
}

function logTransaction(event, endpoint, details = {}) {
  const entry = {
    timestamp: nowIso(),
    event,
    key: endpoint?.key || details.key || null,
    label: endpoint?.label || null,
    type: endpoint?.type || null,
    network: endpoint?.network || null,
    url: endpoint?.url ? maskUrl(endpoint.url) : null,
    ...details,
  };
  appendJsonLine(TRANSACTION_LOG_PATH, entry);
  logger.info(entry, event);
  return entry;
}

function logIssue(event, endpoint, err, details = {}) {
  const entry = {
    timestamp: nowIso(),
    event,
    key: endpoint?.key || details.key || null,
    label: endpoint?.label || null,
    type: endpoint?.type || null,
    network: endpoint?.network || null,
    url: endpoint?.url ? maskUrl(endpoint.url) : null,
    error: {
      message: String(err?.message || err || 'URL_MANAGER_ISSUE'),
      code: err?.code || null,
      status: err?.response?.status || null,
    },
    ...details,
  };
  appendJsonLine(ISSUE_LOG_PATH, entry);
  logger.warn(entry, event);
  return entry;
}

async function checkHttpEndpoint(endpoint) {
  const startedAt = Date.now();
  const method = endpoint.checkMethod === 'get' ? 'GET' : 'HEAD';
  try {
    const response = await axios.request({
      url: endpoint.url,
      method,
      timeout: endpoint.timeoutMs,
      validateStatus: () => true,
    });
    return {
      ok: response.status >= 200 && response.status < 500,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
      checkedAt: nowIso(),
      method,
    };
  } catch (err) {
    if (method === 'HEAD' && ['ERR_BAD_REQUEST', 'ECONNABORTED'].includes(err?.code) === false) {
      try {
        const response = await axios.request({
          url: endpoint.url,
          method: 'GET',
          timeout: endpoint.timeoutMs,
          validateStatus: () => true,
        });
        return {
          ok: response.status >= 200 && response.status < 500,
          statusCode: response.status,
          latencyMs: Date.now() - startedAt,
          checkedAt: nowIso(),
          method: 'GET',
        };
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    throw err;
  }
}

async function checkRpcEndpoint(endpoint) {
  const startedAt = Date.now();
  const network = normalizeKey(endpoint.network);
  let payload = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] };
  if (network === 'solana') {
    payload = { jsonrpc: '2.0', id: 1, method: 'getHealth' };
  }

  const response = await axios.post(endpoint.url, payload, {
    timeout: endpoint.timeoutMs,
    validateStatus: () => true,
  });

  return {
    ok: response.status >= 200 && response.status < 500 && !response.data?.error,
    statusCode: response.status,
    latencyMs: Date.now() - startedAt,
    checkedAt: nowIso(),
    method: 'POST',
    rpcMethod: payload.method,
    rpcError: response.data?.error || null,
  };
}

async function checkEndpoint(endpoint, options = {}) {
  if (options.managerEnabled === false) {
    return {
      ok: false,
      disabled: true,
      checkedAt: nowIso(),
      message: 'URL manager disabled',
    };
  }

  if (!endpoint.enabled) {
    return {
      ok: false,
      disabled: true,
      checkedAt: nowIso(),
      message: 'Endpoint disabled',
    };
  }

  const cached = cache.get(endpoint.key);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  logTransaction('backend_url_status_check_started', endpoint, { actorId: options.actorId || null });

  try {
    const result =
      endpoint.type === 'blockchain_rpc' && normalizeKey(endpoint.network) !== 'tron'
        ? await checkRpcEndpoint(endpoint)
        : await checkHttpEndpoint(endpoint);
    cache.set(endpoint.key, { expiresAt: Date.now() + endpoint.cacheTtlMs, value: result });
    if (endpoint.type === 'blockchain_rpc' && normalizeKey(endpoint.network) !== 'tron') {
      recordRpcStatus({
        network: endpoint.network,
        rpcUrl: endpoint.url,
        ok: Boolean(result.ok),
        service: 'backend_url_manager',
        latencyMs: result.latencyMs,
        error: result.rpcError,
      });
    }
    logTransaction('backend_url_status_check_completed', endpoint, { actorId: options.actorId || null, result });
    return result;
  } catch (err) {
    const result = {
      ok: false,
      checkedAt: nowIso(),
      latencyMs: null,
      error: String(err?.message || err || 'STATUS_CHECK_FAILED'),
      code: err?.code || null,
    };
    cache.set(endpoint.key, { expiresAt: Date.now() + endpoint.cacheTtlMs, value: result });
    if (endpoint.type === 'blockchain_rpc' && normalizeKey(endpoint.network) !== 'tron') {
      recordRpcStatus({
        network: endpoint.network,
        rpcUrl: endpoint.url,
        ok: false,
        service: 'backend_url_manager',
        error: err,
      });
    }
    logIssue('backend_url_status_check_failed', endpoint, err, { actorId: options.actorId || null });
    return result;
  }
}

export function listBackendUrls() {
  const registry = readRegistry();
  return {
    enabled: registry.enabled,
    configPath: CONFIG_PATH,
    cacheTtlMs: cfg.urlManager.cacheTtlMs,
    apiEndpoints: discoverApiEndpoints(),
    endpoints: registry.endpoints.map((endpoint) => ({
      ...endpoint,
      url: endpoint.maskedUrl || maskUrl(endpoint.url),
    })),
  };
}

export function isBackendUrlEnabled(key) {
  const registry = readRegistry();
  const endpoint = registry.endpoints.find((item) => item.key === normalizeKey(key));
  if (!endpoint) return true;
  return Boolean(endpoint.enabled);
}

export async function checkBackendUrlStatus(key, options = {}) {
  const registry = readRegistry();
  const endpoint = registry.endpoints.find((item) => item.key === normalizeKey(key));
  if (!endpoint) {
    const err = new Error('BACKEND_URL_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const result = await checkEndpoint(endpoint, { ...options, managerEnabled: registry.enabled });
  endpoint.lastStatus = result;
  writeRegistry(registry);
  return { endpoint: { ...endpoint, url: maskUrl(endpoint.url) }, result };
}

export async function checkAllBackendUrls(options = {}) {
  const registry = readRegistry();
  const results = [];
  for (const endpoint of registry.endpoints) {
    const result = await checkEndpoint(endpoint, { ...options, managerEnabled: registry.enabled });
    endpoint.lastStatus = result;
    results.push({ endpoint: { ...endpoint, url: maskUrl(endpoint.url) }, result });
  }
  writeRegistry(registry);
  return results;
}

export function upsertBackendUrl(payload, actorId = null) {
  const endpoint = createEndpoint(payload, 'json');
  if (!endpoint) {
    const err = new Error('BACKEND_URL_INVALID');
    err.status = 400;
    throw err;
  }

  const registry = readRegistry();
  const index = registry.endpoints.findIndex((item) => item.key === endpoint.key);
  if (index >= 0) {
    registry.endpoints[index] = {
      ...registry.endpoints[index],
      ...endpoint,
      createdAt: registry.endpoints[index].createdAt,
      updatedAt: nowIso(),
    };
  } else {
    registry.endpoints.push(endpoint);
  }

  cache.delete(endpoint.key);
  const saved = writeRegistry(registry);
  const savedEndpoint = saved.endpoints.find((item) => item.key === endpoint.key);
  logTransaction(index >= 0 ? 'backend_url_updated' : 'backend_url_created', savedEndpoint, { actorId });
  return { ...savedEndpoint, url: maskUrl(savedEndpoint.url) };
}

export function setBackendUrlEnabled(key, enabled, actorId = null) {
  const registry = readRegistry();
  const normalizedKey = normalizeKey(key);
  const endpoint = registry.endpoints.find((item) => item.key === normalizedKey);
  if (!endpoint) {
    const err = new Error('BACKEND_URL_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  endpoint.enabled = Boolean(enabled);
  endpoint.updatedAt = nowIso();
  endpoint.lastStatus = endpoint.enabled
    ? null
    : {
        ok: false,
        disabled: true,
        checkedAt: nowIso(),
        message: 'Endpoint disabled',
      };
  cache.delete(endpoint.key);
  const saved = writeRegistry(registry);
  const savedEndpoint = saved.endpoints.find((item) => item.key === normalizedKey);
  logTransaction(endpoint.enabled ? 'backend_url_enabled' : 'backend_url_disabled', savedEndpoint, { actorId });
  return { ...savedEndpoint, url: maskUrl(savedEndpoint.url) };
}

export function recordBlockchainConnectionTransaction(event, details = {}) {
  const endpoint = createEndpoint({
    key: details.key || `${details.network || 'blockchain'}_${details.service || 'rpc'}`,
    label: details.service || details.network || 'Blockchain connection',
    url: details.rpcUrl || details.url || '',
    type: 'blockchain_rpc',
    network: details.network,
  });
  return logTransaction(event, endpoint, {
    service: details.service || null,
    chainId: details.chainId || null,
    txHash: details.txHash || null,
    extra: details.extra || null,
  });
}

export function recordBlockchainConnectionIssue(event, details = {}) {
  const endpoint = createEndpoint({
    key: details.key || `${details.network || 'blockchain'}_${details.service || 'rpc'}`,
    label: details.service || details.network || 'Blockchain connection',
    url: details.rpcUrl || details.url || '',
    type: 'blockchain_rpc',
    network: details.network,
  });
  return logIssue(event, endpoint, details.error || event, {
    service: details.service || null,
    chainId: details.chainId || null,
    txHash: details.txHash || null,
    extra: details.extra || null,
  });
}

export function readBackendUrlLog(type = 'transactions', limit = 100) {
  const filePath = type === 'issues' ? ISSUE_LOG_PATH : TRANSACTION_LOG_PATH;
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-safeNumber(limit, 100)).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}
