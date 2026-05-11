import { db } from '../db.js';
export async function markets(){ return [{ symbol:'BTCUSDT', price: 65000 }, { symbol:'ETHUSDT', price: 3200 }]; }
export async function listOrders(userId){ return db('paper_orders').where({ user_id:userId }).orderBy('created_at','desc'); }
export async function placeOrder(userId, o){ const [id]=await db('paper_orders').insert({ user_id:userId, ...o, status:'NEW' }); return db('paper_orders').where({ id }).first(); }
export async function cancel(userId,id){ await db('paper_orders').where({ id, user_id:userId }).update({ status:'CANCELED' }); }
export async function positions(userId){ return db('paper_positions').where({ user_id:userId }); }
export async function history(userId){ return db('paper_orders').where({ user_id:userId }).andWhere('status','!=','NEW'); }