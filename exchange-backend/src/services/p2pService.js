import { db } from '../db.js';


export async function listings({ type='BUY', limit=20, offset=0 }){
return db('p2p_listings').where({ type, status:'ACTIVE' }).limit(limit).offset(offset).orderBy('id','desc');
}


export async function seedListing(adminId, l){ const [id]=await db('p2p_listings').insert({ ...l, trader_id: adminId, status:'ACTIVE' }); return db('p2p_listings').where({ id }).first(); }


export async function createOrder(user, { listingId, fiatAmount }){
const listing = await db('p2p_listings').where({ id: listingId, status:'ACTIVE' }).first();
if (!listing) throw new Error('Listing not found');
if (!user.kycVerified) throw new Error('KYC required');
if (fiatAmount < Number(listing.min_amount) || fiatAmount > Number(listing.max_amount)) throw new Error('Out of bounds');
const cryptoAmount = fiatAmount / Number(listing.price);
const [id] = await db('p2p_orders').insert({
listing_id: listing.id,
buyer_id: user.id,
seller_id: listing.type==='SELL'? listing.trader_id : user.id,
type: listing.type,
fiat_amount: fiatAmount,
crypto_amount: cryptoAmount,
status: 'ESCROW_LOCKED',
escrow_amount: cryptoAmount
});
return db('p2p_orders').where({ id }).first();
}


export async function orderById(userId, id){
const o = await db('p2p_orders').where({ id }).first();
if (!o) throw new Error('Not found');
if (![o.buyer_id, o.seller_id].includes(userId)) throw new Error('Forbidden');
return o;
}


export async function setStatus(userId, id, next){
const o = await db('p2p_orders').where({ id }).first();
if (!o) throw new Error('Not found');
if (next==='WAITING_PAYMENT') {
if (userId!==o.seller_id) throw new Error('Only seller can acknowledge');
}
if (next==='PAID') {
if (userId!==o.buyer_id) throw new Error('Only buyer can mark paid');
}
if (next==='RELEASED') {
if (userId!==o.seller_id) throw new Error('Only seller can release');
// credit buyer spot wallet
const w = await db('wallets').where({ user_id:o.buyer_id, type:'spot', asset:'USDT' }).first();
await db('wallets').where({ id:w.id }).update({ balance: db.raw('balance + ?', [o.crypto_amount]) });
await db('p2p_orders').where({ id }).update({ escrow_released_at: new Date() });
}
await db('p2p_orders').where({ id }).update({ status: next });
}


export async function cancel(userId, id){
const o = await db('p2p_orders').where({ id }).first();
if (!o) throw new Error('Not found');
if (o.status==='RELEASED') throw new Error('Cannot cancel');
if (![o.buyer_id, o.seller_id].includes(userId)) throw new Error('Forbidden');
await db('p2p_orders').where({ id }).update({ status: 'CANCELED' });
}


export async function chat(userId, orderId, body){
const o = await db('p2p_orders').where({ id:orderId }).first();
if (![o.buyer_id, o.seller_id].includes(userId)) throw new Error('Forbidden');
const author = userId===o.buyer_id ? 'buyer':'seller';
await db('p2p_order_messages').insert({ order_id: orderId, author, body });
}