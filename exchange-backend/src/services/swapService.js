import { db } from '../db.js';


export async function quote({ from, to, amount }){
amount = Number(amount);
const rate = (from==='BTC'&&to==='ETH')? 14 : 0.05; // demo rate table
const fee = 0.003; // 0.3%
const out = amount * rate * (1-fee);
return { price: rate, amountOut: out, feePct: fee };
}


export async function execute(userId, { from, to, amountIn, slippagePct=0.5 }){
const q = await quote({ from, to, amount: amountIn });
// adjust balances naive
const fromW = await db('wallets').where({ user_id:userId, type:'spot', asset: from }).first();
const toW = await db('wallets').where({ user_id:userId, type:'spot', asset: to }).first();
if (!fromW||!toW) throw new Error('Wallet missing');
if (Number(fromW.balance) < amountIn) throw new Error('Insufficient');
await db.transaction(async trx=>{
await trx('wallets').where({ id: fromW.id }).update({ balance: trx.raw('balance - ?', [amountIn]) });
await trx('wallets').where({ id: toW.id }).update({ balance: trx.raw('balance + ?', [q.amountOut]) });
await trx('swap_quotes').insert({ user_id:userId, from_asset:from, to_asset:to, amount_in:amountIn, amount_out:q.amountOut, slippage: slippagePct, routing: JSON.stringify({dex:'stub'}) });
});
return { executed: true };
}


export async function history(userId){ return db('swap_quotes').where({ user_id:userId }).orderBy('created_at','desc'); }