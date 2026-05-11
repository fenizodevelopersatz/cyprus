import { exchangeEmitter } from '../services/binanceSync.js';
import { matchSpotOrders } from '../services/spotMatchingService.js';
import { queueLogger } from '../logging/loggers.js';

const pending = new Map();

function schedule(symbol, price) {
  const upper = symbol?.toUpperCase();
  if (!upper || !Number.isFinite(price)) return;
  if (pending.has(upper)) {
    pending.set(upper, price);
    return;
  }
  pending.set(upper, price);
  setImmediate(async () => {
    const latest = pending.get(upper);
    pending.delete(upper);
    try {
      await matchSpotOrders(upper, latest);
    } catch (err) {
      queueLogger.error({ err, symbol: upper, price: latest, job: 'spot_matcher' }, 'match_failed');
    }
  });
}

export function startSpotMatcher() {
  exchangeEmitter.on('ticker', ({ symbol, last }) => {
    schedule(symbol, Number(last));
  });
}

