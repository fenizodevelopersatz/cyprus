import { cfg } from '../config.js';

const ASSET_DIRECTORY = Object.freeze({
  BTC: { name: 'Bitcoin', slug: 'btc', color: '#f7931a' },
  ETH: { name: 'Ethereum', slug: 'eth', color: '#627eea' },
  SOL: { name: 'Solana', slug: 'sol', color: '#66f9a1' },
  BNB: { name: 'BNB', slug: 'bnb', color: '#f3ba2f' },
  XRP: { name: 'XRP', slug: 'xrp', color: '#23292f' },
  DOGE: { name: 'Dogecoin', slug: 'doge', color: '#c2a633' },
  TRX: { name: 'TRON', slug: 'trx', color: '#ff060a' },
  ADA: { name: 'Cardano', slug: 'ada', color: '#0033ad' },
  USDT: { name: 'Tether USDt', slug: 'usdt', color: '#26a17b' },
  USDC: { name: 'USD Coin', slug: 'usdc', color: '#2775ca' },
  BUSD: { name: 'Binance USD', slug: 'busd', color: '#f0b90b' },
  FDUSD: { name: 'First Digital USD', slug: 'fdusd', color: '#1b5f4a' },
  TUSD: { name: 'TrueUSD', slug: 'tusd', color: '#1f75fe' },
  EUR: { name: 'Euro', slug: 'eur', color: '#003399' },
  TRY: { name: 'Turkish Lira', slug: 'try', color: '#e30a17' },
  BRL: { name: 'Brazilian Real', slug: 'brl', color: '#009c3b' },
  AUD: { name: 'Australian Dollar', slug: 'aud', color: '#012169' },
  GBP: { name: 'British Pound', slug: 'gbp', color: '#012169' },
  JPY: { name: 'Japanese Yen', slug: 'jpy', color: '#bc002d' },
  RUB: { name: 'Russian Ruble', slug: 'rub', color: '#d52b1e' },
});

function resolveIconUrl(meta) {
  const base = cfg.ui?.assetIconBase;
  if (!base) return null;
  const normalizedBase = String(base).replace(/\/+$/, '');
  const iconId = meta.icon ?? meta.slug ?? meta.symbol.toLowerCase();
  return `${normalizedBase}/${iconId}.svg`;
}

export function getAssetMeta(asset) {
  const symbol = String(asset || '').toUpperCase();
  if (!symbol) {
    return {
      asset: null,
      symbol: null,
      name: null,
      slug: null,
      icon: null,
      iconUrl: null,
      color: null,
    };
  }
  const baseMeta = ASSET_DIRECTORY[symbol] || {};
  const slug = baseMeta.slug || symbol.toLowerCase();
  const icon = baseMeta.icon || slug;
  const resolved = {
    asset: symbol,
    symbol,
    name: baseMeta.name || symbol,
    slug,
    icon,
    color: baseMeta.color || null,
  };
  return {
    ...resolved,
    iconUrl: resolveIconUrl(resolved),
  };
}

export function getAssetDirectory(assets = []) {
  const unique = Array.from(
    new Set(
      assets
        .map((asset) => String(asset || '').toUpperCase())
        .filter((item) => item && item !== 'null' && item !== 'undefined')
    )
  );
  return unique.map((asset) => getAssetMeta(asset));
}
