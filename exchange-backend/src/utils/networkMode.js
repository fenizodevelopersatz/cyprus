const MODE_ALIASES = {
  production: 'mainnet',
  prod: 'mainnet',
  live: 'mainnet',
  main: 'mainnet',
  mainnet: 'mainnet',
  test: 'testnet',
  testnet: 'testnet',
  staging: 'testnet',
  dev: 'devnet',
  development: 'devnet',
  devnet: 'devnet',
  local: 'devnet',
};

export function getNetworkMode() {
  const raw = String(process.env.NETWORK_MODE || process.env.CHAIN_MODE || process.env.NETWORK || 'devnet')
    .trim()
    .toLowerCase();
  return MODE_ALIASES[raw] || raw || 'devnet';
}

export function getSolanaMode() {
  const raw = String(process.env.SOLANA_NETWORK || getNetworkMode()).trim().toLowerCase();
  if (raw === 'mainnet-beta') return 'mainnet';
  return MODE_ALIASES[raw] || raw || 'devnet';
}

export function pickEnvByMode(keysByMode, fallbackKeys = []) {
  const mode = getNetworkMode();
  const modeKeys = keysByMode?.[mode] || [];
  const keys = [...modeKeys, ...fallbackKeys];
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

export function getNetworkModeSummary() {
  return {
    mode: getNetworkMode(),
    solanaMode: getSolanaMode(),
  };
}
