import TronWebModule from 'tronweb';

function resolveTronWebConstructor(mod) {
  return mod?.TronWeb || mod?.default?.TronWeb || mod?.default || mod;
}

export function normalizeTronHost(host) {
  const raw = String(host || '').trim();
  if (!raw) return 'https://nile.trongrid.io';

  const lower = raw.toLowerCase();
  if (lower.includes('tronscan.org')) {
    if (lower.includes('nile')) return 'https://nile.trongrid.io';
    if (lower.includes('shasta')) return 'https://api.shasta.trongrid.io';
    return 'https://api.trongrid.io';
  }

  return raw;
}

function resolveFullHost(fullHost) {
  const rawValue = String(
    fullHost ||
      process.env.TRX_API_URL ||
      process.env.TRON_API_BASE ||
      process.env.TRON_FULL_HOST ||
      ''
  ).trim();

  if (!rawValue) {
    const err = new Error('TRX_API_URL_NOT_CONFIGURED');
    err.status = 400;
    throw err;
  }

  const value = normalizeTronHost(rawValue);
  if (value.toLowerCase().includes('tronscan.org')) {
    const err = new Error('CONFIG_INVALID_TRON_FULL_HOST');
    err.status = 400;
    throw err;
  }

  return value;
}

function buildHeaders() {
  const apiKey = String(process.env.TRX_API_TOKEN || process.env.TRON_API_KEY || '').trim();
  return apiKey
    ? {
        'TRON-PRO-API-KEY': apiKey,
      }
    : undefined;
}

function normalizePrivateKey(privateKey) {
  const value = String(privateKey || '').trim();
  if (!value) return '';
  return value.startsWith('0x') ? value.slice(2) : value;
}

function assertTronAddress(address, code = 'TRON_OWNER_ADDRESS_MISSING') {
  const normalized = String(address || '').trim();
  if (!normalized) {
    const err = new Error(code);
    err.status = 400;
    throw err;
  }
  return normalized;
}

export function getTronWebConstructor() {
  const TronWebClass = resolveTronWebConstructor(TronWebModule);
  if (typeof TronWebClass !== 'function') {
    const err = new Error('TRON_CLIENT_CONSTRUCTOR_UNAVAILABLE');
    err.status = 500;
    throw err;
  }
  return TronWebClass;
}

export function getTronClient({ fullHost, privateKey } = {}) {
  const TronWebClass = getTronWebConstructor();
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  const client = new TronWebClass({
    fullHost: resolveFullHost(fullHost),
    privateKey: normalizedPrivateKey || undefined,
    headers: buildHeaders(),
  });

  if (normalizedPrivateKey) {
    const address = assertTronAddress(client.address.fromPrivateKey(normalizedPrivateKey), 'TRON_PRIVATE_KEY_INVALID');
    if (typeof client.setPrivateKey === 'function') {
      client.setPrivateKey(normalizedPrivateKey);
    }
    client.setAddress(address);
  }
  console.log('getTronClient-98->', { fullHost, privateKey: privateKey, normalizedPrivateKey, clientAddress: client?.address?.toString?.() });
  return client;
}

export function getTronOwnerAddress(client, privateKey) {
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  if (!normalizedPrivateKey) {
    const err = new Error('TRON_PRIVATE_KEY_MISSING');
    err.status = 400;
    throw err;
  }
  return assertTronAddress(client?.address?.fromPrivateKey?.(normalizedPrivateKey), 'TRON_OWNER_ADDRESS_MISSING');
}

export async function validateTronClientConnection(client) {
  await client.trx.getCurrentBlock();
  return client;
}

export async function getTronAccountInfo(address, fullHost) {
  const client = getTronClient({ fullHost });
  return client.trx.getAccount(String(address || '').trim());
}

export async function isTronAccountActive(address, fullHost) {
  const account = await getTronAccountInfo(address, fullHost).catch(() => null);
  return Boolean(account && (account.address || account.create_time || account.balance !== undefined));
}

export async function createTronAccount() {
  const TronWebClass = getTronWebConstructor();
  const createAccountFn =
    TronWebClass?.createAccount ||
    TronWebClass?.utils?.accounts?.generateAccount;

  if (typeof createAccountFn !== 'function') {
    const err = new Error('TRON_WALLET_GENERATOR_UNAVAILABLE');
    err.status = 500;
    throw err;
  }

  return createAccountFn();
}
