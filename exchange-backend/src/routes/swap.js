/**
 * @openapi
 * tags:
 *   - name: Swap
 *     description: Quotes & executions
 */

/**
 * @openapi
 * /swap/quote:
 *   get:
 *     summary: Get swap quote
 *     tags: [Swap]
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: amount
 *         required: true
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Quote
 */

/**
 * @openapi
 * /swap/execute:
 *   post:
 *     summary: Execute a swap
 *     security:
 *       - bearerAuth: []
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to, amountIn]
 *             properties:
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               amountIn:
 *                 type: number
 *               slippagePct:
 *                 type: number
 *     responses:
 *       200:
 *         description: Executed
 */

/**
 * @openapi
 * /swap/history:
 *   get:
 *     summary: Swap history
 *     security:
 *       - bearerAuth: []
 *     tags: [Swap]
 *     responses:
 *       200:
 *         description: History
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import * as svc from '../services/swapService.js';


const r = express.Router();


r.get('/quote', async (req,res)=>{ const { from, to, amount }=req.query; ok(res, await svc.quote({ from, to, amount })); });


r.post('/execute', requireAuth, async (req,res)=>{ try{ ok(res, await svc.execute(req.user.id, req.body)); }catch(e){ fail(res,e.message,400);} });


r.get('/history', requireAuth, async (req,res)=> ok(res, await svc.history(req.user.id)) );


export default r;