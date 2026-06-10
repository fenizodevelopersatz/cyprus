import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.resolve(APP_ROOT, 'storage');
const RPC_STATUS_PATH = path.resolve(STORAGE_DIR, 'rpc-status.json');
const BACKEND_URL_REGISTRY_PATH = path.resolve(STORAGE_DIR, 'backend-url-registry.json');
const SUPPORTED_RPC_NETWORKS = new Set(['ethereum', 'bsc', 'tron', 'solana']);
const DEFAULT_FAILURE_COOLDOWN_MS = Number(process.env.RPC_FAILURE_COOLDOWN_MS || 5 * 60 * 1000);

function nowIso() {
  return new Date().toISOString();
}

export function parseRpcUrls(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeNetwork(value) {
  return String(value || '').trim().toLowerCase();
}

function isSupportedRpcNetwork(network) {
  return SUPPORTED_RPC_NETWORKS.has(normalizeNetwork(network));
}

function readAdminRpcUrls(network) {
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork || !isSupportedRpcNetwork(normalizedNetwork)) return [];

  try {
    if (!fs.existsSync(BACKEND_URL_REGISTRY_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(BACKEND_URL_REGISTRY_PATH, 'utf8'));
    const endpoints = Array.isArray(parsed?.endpoints) ? parsed.endpoints : [];
    return [
      ...new Set(
        endpoints
          .filter((endpoint) => {
            const source = String(endpoint?.source || '').trim().toLowerCase();
            return (
              endpoint?.enabled !== false &&
              String(endpoint?.type || '').trim().toLowerCase() === 'blockchain_rpc' &&
              normalizeNetwork(endpoint?.network) === normalizedNetwork &&
              source !== 'env_default'
            );
          })
          .flatMap((endpoint) => parseRpcUrls(endpoint?.url))
      ),
    ];
  } catch {
    return [];
  }
}

export function getRuntimeRpcUrlGroups({ rpcUrl, network }) {
  const adminUrls = readAdminRpcUrls(network);
  const defaultUrls = parseRpcUrls(rpcUrl).filter((url) => !adminUrls.includes(url));
  return {
    adminUrls,
    defaultUrls,
    allUrls: [...adminUrls, ...defaultUrls],
  };
}

export function readRpcStatusDb() {
  try {
    if (!fs.existsSync(RPC_STATUS_PATH)) {
      return { version: 1, updatedAt: nowIso(), networks: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(RPC_STATUS_PATH, 'utf8'));
    return {
      version: 1,
      updatedAt: parsed?.updatedAt || nowIso(),
      networks: parsed?.networks && typeof parsed.networks === 'object' ? parsed.networks : {},
    };
  } catch {
    return { version: 1, updatedAt: nowIso(), networks: {} };
  }
}

function writeRpcStatusDb(db) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const payload = { ...db, updatedAt: nowIso() };
  fs.writeFileSync(RPC_STATUS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function ensureNetwork(db, network) {
  const key = String(network || 'unknown').trim().toLowerCase() || 'unknown';
  if (!db.networks[key]) {
    db.networks[key] = {
      activeUrl: null,
      updatedAt: nowIso(),
      endpoints: {},
    };
  }
  return { key, state: db.networks[key] };
}

export function orderRpcUrlsForUse(urls, network) {
  const list = parseRpcUrls(urls);
  if (list.length <= 1) return list;

  const db = readRpcStatusDb();
  const { state } = ensureNetwork(db, network);
  const activeUrl = state.activeUrl && list.includes(state.activeUrl) ? state.activeUrl : null;
  const cooldownMs = Number.isFinite(DEFAULT_FAILURE_COOLDOWN_MS) && DEFAULT_FAILURE_COOLDOWN_MS > 0 ? DEFAULT_FAILURE_COOLDOWN_MS : 0;
  const scoredCandidates = list
    .filter((url) => url !== activeUrl)
    .map((url, index) => {
      const endpoint = state.endpoints?.[url] || {};
      const lastFailureMs = endpoint.lastFailureAt ? new Date(endpoint.lastFailureAt).getTime() : 0;
      const inCooldown = endpoint.status === 'failed' && lastFailureMs > 0 && Date.now() - lastFailureMs < cooldownMs;
      return {
        url,
        index,
        ok: endpoint.status === 'ok',
        inCooldown,
        lastSuccessAt: endpoint.lastSuccessAt || '',
        failures: Number(endpoint.failureCount || 0),
      };
    });
  const activeEndpoint = activeUrl ? state.endpoints?.[activeUrl] || {} : {};
  const activeFailureMs = activeEndpoint.lastFailureAt ? new Date(activeEndpoint.lastFailureAt).getTime() : 0;
  const activeInCooldown =
    activeUrl &&
    activeEndpoint.status === 'failed' &&
    activeFailureMs > 0 &&
    Date.now() - activeFailureMs < cooldownMs;
  const usableCandidates = scoredCandidates.filter((item) => !item.inCooldown);
  const scored = (usableCandidates.length > 0 ? usableCandidates : scoredCandidates)
    .sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      if (a.inCooldown !== b.inCooldown) return a.inCooldown ? 1 : -1;
      if (a.lastSuccessAt !== b.lastSuccessAt) return a.lastSuccessAt > b.lastSuccessAt ? -1 : 1;
      if (a.failures !== b.failures) return a.failures - b.failures;
      return a.index - b.index;
    })
    .map((item) => item.url);

  return activeUrl && !activeInCooldown ? [activeUrl, ...scored] : scored;
}

export function orderRuntimeRpcUrlsForUse({ rpcUrl, network }) {
  const { adminUrls, defaultUrls } = getRuntimeRpcUrlGroups({ rpcUrl, network });
  return [
    ...orderRpcUrlsForUse(adminUrls, network),
    ...orderRpcUrlsForUse(defaultUrls, network),
  ];
}

export function recordRpcStatus({ network, rpcUrl, ok, service = null, latencyMs = null, error = null, chainId = null }) {
  if (!isSupportedRpcNetwork(network)) return null;
  const db = readRpcStatusDb();
  const { key, state } = ensureNetwork(db, network);
  const previous = state.endpoints[rpcUrl] || {};
  const timestamp = nowIso();

  state.endpoints[rpcUrl] = {
    url: rpcUrl,
    status: ok ? 'ok' : 'failed',
    service,
    chainId,
    latencyMs,
    checkedAt: timestamp,
    lastSuccessAt: ok ? timestamp : previous.lastSuccessAt || null,
    lastFailureAt: ok ? previous.lastFailureAt || null : timestamp,
    successCount: Number(previous.successCount || 0) + (ok ? 1 : 0),
    failureCount: ok ? Number(previous.failureCount || 0) : Number(previous.failureCount || 0) + 1,
    error: ok
      ? null
      : {
          message: String(error?.message || error || 'RPC_FAILED'),
          code: error?.code || null,
          shortMessage: error?.shortMessage || null,
        },
  };

  if (ok) state.activeUrl = rpcUrl;
  if (!ok && state.activeUrl === rpcUrl) state.activeUrl = null;
  state.updatedAt = timestamp;
  db.networks[key] = state;
  writeRpcStatusDb(db);
  return state.endpoints[rpcUrl];
}

export { RPC_STATUS_PATH };
