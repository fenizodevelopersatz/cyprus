import { db } from '../db.js';


export async function summary(userId) {
const rows = await db('wallets').where({ user_id: userId });
const grouped = rows.reduce((acc,r)=>{ (acc[r.type]=acc[r.type]||[]).push({ asset:r.asset,balance: Number(r.balance) }); return acc; },{});
return grouped;
}


export async function activity(userId, { limit=50 }) {
return db('wallet_transactions as t')
.join('wallets as w','t.wallet_id','w.id')
.where('w.user_id', userId)
.orderBy('t.created_at','desc')
.limit(limit)
.select('t.*','w.type','w.asset');
}


export async function transfer(userId,{fromWallet,toWallet,asset,amount}){
amount = Number(amount);
if (amount<=0) throw new Error('Invalid amount');
const from = await db('wallets').where({ user_id:userId, type:fromWallet, asset }).first();
const to = await db('wallets').where({ user_id:userId, type:toWallet, asset }).first();
if (!from||!to) throw new Error('Wallet not found');
if (Number(from.balance) < amount) throw new Error('Insufficient balance');
await db.transaction(async trx=>{
await trx('wallets').where({ id: from.id }).update({ balance: trx.raw('balance - ?', [amount]) });
await trx('wallets').where({ id: to.id }).update({ balance: trx.raw('balance + ?', [amount]) });
await trx('wallet_transactions').insert({ wallet_id: from.id, type:'transfer_out', amount:-amount, balance_after: trx.raw('balance'), metadata: JSON.stringify({to:toWallet}) });
await trx('wallet_transactions').insert({ wallet_id: to.id, type:'transfer_in', amount: amount, balance_after: trx.raw('balance'), metadata: JSON.stringify({from:fromWallet}) });
});
}