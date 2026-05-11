import { getTickerCache } from '../services/binanceSync.js';

export function startFuturesTicker(io){
setInterval(()=>{
const ticker = getTickerCache().get('BTCUSDT');
if(!ticker) return;
io.to('futures.mark.BTCUSDT').emit('mark', { symbol:'BTCUSDT', mark:ticker.last, ts: Date.now() });
io.to('futures.funding.BTCUSDT').emit('funding', { symbol:'BTCUSDT', rate:0, ts: Date.now() });
}, 2000);
}
