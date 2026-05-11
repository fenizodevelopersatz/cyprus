/**
 * @openapi
 * tags:
 *   - name: P2P
 *     description: Peer-to-peer desk (KYC required for orders)
 */

/**
 * @openapi
 * /p2p/orders/{id}:
 *   get:
 *     summary: P2P order by id
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order
 */

/**
 * @openapi
 * /p2p/orders/{id}/acknowledge:
 *   post:
 *     summary: Seller acknowledges (WAITING_PAYMENT)
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     responses:
 *       200:
 *         description: Updated
 */

/**
 * @openapi
 * /p2p/orders/{id}/mark-paid:
 *   post:
 *     summary: Buyer marks as paid
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     responses:
 *       200:
 *         description: Updated
 */

/**
 * @openapi
 * /p2p/orders/{id}/release:
 *   post:
 *     summary: Seller releases escrow
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     responses:
 *       200:
 *         description: Released
 */

/**
 * @openapi
 * /p2p/orders/{id}/cancel:
 *   post:
 *     summary: Cancel order (rules apply)
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     responses:
 *       200:
 *         description: Canceled
 */

/**
 * @openapi
 * /p2p/orders/{id}/chat:
 *   post:
 *     summary: Post chat message
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: Sent
 */

/**
 * @openapi
 * /p2p/orders/{id}/chat:
 *   get:
 *     summary: Fetch chat messages
 *     security:
 *       - bearerAuth: []
 *     tags: [P2P]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Messages
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, requireKycVerified } from '../middleware/roles.js';
import { ok, fail } from '../utils/responses.js';
import * as svc from '../services/p2pService.js';


const r = express.Router();


r.get('/listings', async (req,res)=>{ const { type='BUY', limit=20, offset=0 } = req.query; ok(res, await svc.listings({ type, limit:Number(limit), offset:Number(offset) })); });


r.post('/listings', requireAuth, requireRole('admin'), async (req,res)=>{ try{ ok(res, await svc.seedListing(req.user.id, req.body)); }catch(e){ fail(res,e.message,400);} });


r.post('/orders', requireAuth, requireKycVerified, async (req,res)=>{ try{ ok(res, await svc.createOrder(req.user, req.body)); }catch(e){ fail(res,e.message,400);} });


r.get('/orders', requireAuth, async (req,res)=>{ ok(res, await req.app.get('db')('p2p_orders').where(builder=>builder.where('buyer_id',req.user.id).orWhere('seller_id',req.user.id)).orderBy('created_at','desc')); });


r.get('/orders/:id', requireAuth, async (req,res)=>{ try{ ok(res, await svc.orderById(req.user.id, req.params.id)); }catch(e){ fail(res,e.message,404);} });


r.post('/orders/:id/acknowledge', requireAuth, async (req,res)=>{ try{ await svc.setStatus(req.user.id, req.params.id, 'WAITING_PAYMENT'); ok(res,{ status:'WAITING_PAYMENT' }); }catch(e){ fail(res,e.message,400);} });


r.post('/orders/:id/mark-paid', requireAuth, async (req,res)=>{ try{ await svc.setStatus(req.user.id, req.params.id, 'PAID'); ok(res,{ status:'PAID' }); }catch(e){ fail(res,e.message,400);} });


r.post('/orders/:id/release', requireAuth, async (req,res)=>{ try{ await svc.setStatus(req.user.id, req.params.id, 'RELEASED'); ok(res,{ status:'RELEASED' }); }catch(e){ fail(res,e.message,400);} });


r.post('/orders/:id/cancel', requireAuth, async (req,res)=>{ try{ await svc.cancel(req.user.id, req.params.id); ok(res,{ status:'CANCELED' }); }catch(e){ fail(res,e.message,400);} });


r.post('/orders/:id/chat', requireAuth, async (req,res)=>{ try{ ok(res, await svc.chat(req.user.id, req.params.id, req.body.body)); }catch(e){ fail(res,e.message,400);} });


r.get('/orders/:id/chat', requireAuth, async (req,res)=>{ try{ ok(res, await svc.getChat(req.user.id, req.params.id)); }catch(e){ fail(res,e.message,400);} });


export default r;