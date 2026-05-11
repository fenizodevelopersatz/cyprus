import { getTickerCache } from '../services/binanceSync.js';

export function startMarketTicker(io){
setInterval(()=>{
const ticker = getTickerCache().get('BTCUSDT');
if(!ticker) return;
io.to('market.ticker.BTCUSDT').emit('tick', { symbol:'BTCUSDT', price: ticker.last, change: ticker.change, ts: Date.now() });
}, 1000);
}
