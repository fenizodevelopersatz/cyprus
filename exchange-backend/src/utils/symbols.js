import { cfg } from '../config.js';

const BASE_SPOT_META = {
  BTCUSDT: { base: 'BTC', quote: 'USDT', tick: 0.1, lot: 0.0001, min: 0.0002, max: 100 },
  ETHUSDT: { base: 'ETH', quote: 'USDT', tick: 0.01, lot: 0.001, min: 0.01, max: 500 },
  SOLUSDT: { base: 'SOL', quote: 'USDT', tick: 0.01, lot: 0.01, min: 0.01, max: 5000 },
  BNBUSDT: { base: 'BNB', quote: 'USDT', tick: 0.01, lot: 0.01, min: 0.01, max: 5000 },
  XRPUSDT: { base: 'XRP', quote: 'USDT', tick: 0.0001, lot: 1, min: 1, max: 1000000 },
  DOGEUSDT: { base: 'DOGE', quote: 'USDT', tick: 0.0001, lot: 1, min: 1, max: 1000000 },
  TRXUSDT: { base: 'TRX', quote: 'USDT', tick: 0.0001, lot: 1, min: 1, max: 1000000 },
  ADAUSDT: { base: 'ADA', quote: 'USDT', tick: 0.0001, lot: 0.1, min: 0.1, max: 100000 },
};

const FALLBACK_ALLOWED = Object.keys(BASE_SPOT_META);

const configuredSpot =
  Array.isArray(cfg.binance?.allowedSpotSymbols) && cfg.binance.allowedSpotSymbols.length
    ? cfg.binance.allowedSpotSymbols.map((s) => s.toUpperCase())
    : FALLBACK_ALLOWED;
export const allowedSpotSymbols = Array.from(new Set(configuredSpot));
const allowedSpotSymbolSet = new Set(allowedSpotSymbols);

const configuredFutures =
  Array.isArray(cfg.binance?.allowedFuturesSymbols) && cfg.binance.allowedFuturesSymbols.length
    ? cfg.binance.allowedFuturesSymbols.map((s) => s.toUpperCase())
    : allowedSpotSymbols.filter((symbol) => symbol.endsWith('USDT'));
export const allowedFuturesSymbols = Array.from(new Set(configuredFutures));
const allowedFuturesSymbolSet = new Set(allowedFuturesSymbols);

export function isSpotSymbolAllowed(symbol) {
  if (!symbol) return false;
  if (!allowedSpotSymbolSet.size) return true;
  return allowedSpotSymbolSet.has(symbol.toUpperCase());
}

export function isFuturesSymbolAllowed(symbol) {
  if (!symbol) return false;
  if (!allowedFuturesSymbolSet.size) return true;
  return allowedFuturesSymbolSet.has(symbol.toUpperCase());
}

function resolveFallbackMeta(symbol) {
  const upper = symbol.toUpperCase();
  if (BASE_SPOT_META[upper]) return BASE_SPOT_META[upper];
  if (upper.endsWith('USDT')) {
    const base = upper.slice(0, -4) || upper;
    return { base, quote: 'USDT', tick: 0.01, lot: 0.01, min: 0.01, max: 100000 };
  }
  return { base: upper, quote: 'USDT', tick: 0.01, lot: 0.01, min: 0.01, max: 100000 };
}

export const symbols = allowedSpotSymbols.reduce((acc, symbol) => {
  acc[symbol] = resolveFallbackMeta(symbol);
  return acc;
}, {});
export const symbolMeta = symbols;

export const futuresLimits = { maxLev: 50, minLev: 1 };
