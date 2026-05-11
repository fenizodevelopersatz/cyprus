import { startMarketStreams, bootstrapUserStreams, trackSpotSymbol } from '../services/binanceSync.js';
import { db } from '../db.js';
import { isSpotSymbolAllowed } from '../utils/symbols.js';
import { cronLogger } from '../logging/loggers.js';

async function initSymbolWatchlist() {
  try {
    const symbols = await db('market_symbols').pluck('symbol');
    for (const symbol of symbols) {
      if (isSpotSymbolAllowed(symbol)) {
        trackSpotSymbol(symbol);
      }
    }
  } catch (err) {
    cronLogger.warn({ err, job: 'binance_sync', event: 'watchlist_preload_failed' }, 'watchlist_preload_failed');
  }
}

export async function startBinanceSync() {
  startMarketStreams();
  await initSymbolWatchlist();
  await bootstrapUserStreams();
}
