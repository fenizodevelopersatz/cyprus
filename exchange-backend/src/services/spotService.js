import { db } from '../db.js';
import { symbols } from '../utils/symbols.js';
import { withTx } from '../db.js';


function assertSymbol(sym){ if(!symbols[sym]) throw new Error('Unknown symbol'); }
function clampToTick(v,t){ return Math.round(v/t)*t; }


export async function placeOrder(userId, { symbol, side, type, price, size }){
assertSymbol(symbol);
const info = symbols[symbol];
size = Number(size);
if (size<info.min || size>info.max) throw new Error('Size out of bounds');
if (type==='LIMIT') price = Number(price);
if (type==='LIMIT' && price<=0) throw new Error('Invalid price');


return withTx(async trx=>{
const [id] = await trx('spot_orders').insert({ user_id:userId, symbol, side, type, price: price||null, size, filled:0, status:'NEW' });
// naive FIFO match against opposite side
if (type==='MARKET') {
const book = side==='BUY'
? await trx('spot_orders').where({ symbol, side:'SELL', status:'NEW' }).orderBy('created_at','asc')
: await trx('spot_orders').where({ symbol, side:'BUY', status:'NEW' }).orderBy('created_at','asc');
let remaining = size;
for (const o of book){
const available = Number(o.size) - Number(o.filled);
if (available<=0) continue;
const traded = Math.min(remaining, available);
const priceExec = o.price || price || (info.tick);
await trx('spot_trades').insert({ order_id: id, match_id: o.id, price: priceExec, size: traded, fee: 0.0005*traded });
await trx('spot_orders').where({ id }).update({ filled: trx.raw('filled + ?', [traded]) });
await trx('spot_orders').where({ id:o.id }).update({ filled: trx.raw('filled + ?', [traded]) });
if (traded === available) await trx('spot_orders').where({ id:o.id }).update({ status:'FILLED' });
remaining -= traded;
if (remaining<=0) break;
}
const self = await trx('spot_orders').where({ id }).first();
if (Number(self.filled)>=Number(self.size)) await trx('spot_orders').where({ id }).update({ status:'FILLED' });
}
return await trx('spot_orders').where({ id }).first();
});
}


export async function cancelOrder(userId, id){
const o = await db('spot_orders').where({ id, user_id:userId }).first();
if (!o) throw new Error('Not found');
if (o.status!=='NEW') throw new Error('Cannot cancel');
await db('spot_orders').where({ id }).update({ status:'CANCELED' });
}


export async function listOpen(userId){ return db('spot_orders').where({ user_id:userId }).andWhere(q=>q.where('status','NEW').orWhere('status','PARTIALLY_FILLED')).orderBy('created_at','desc'); }
export async function listHistory(userId){ return db('spot_orders').where({ user_id:userId }).andWhere('status','!=','NEW').orderBy('created_at','desc'); }