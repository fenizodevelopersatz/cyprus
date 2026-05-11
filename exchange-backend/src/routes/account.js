// =============================
// src/routes/account.js
// =============================

/**
 * @openapi
 * tags:
 *   - name: Account
 *     description: Wallets & activity management
 */

/**
 * @openapi
 * /account/summary:
 *   get:
 *     summary: Get wallet balances by wallet type
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Account
 *     responses:
 *       200:
 *         description: Wallet balances retrieved successfully
 */

/**
 * @openapi
 * /account/activity:
 *   get:
 *     summary: Get recent wallet transactions
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Account
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of transactions to return
 *     responses:
 *       200:
 *         description: List of recent account activities
 */

/**
 * @openapi
 * /account/transfer:
 *   post:
 *     summary: Transfer funds between wallets
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromWallet
 *               - toWallet
 *               - asset
 *               - amount
 *             properties:
 *               fromWallet:
 *                 type: string
 *                 example: "main"
 *               toWallet:
 *                 type: string
 *                 example: "trading"
 *               asset:
 *                 type: string
 *                 example: "USDT"
 *               amount:
 *                 type: number
 *                 example: 100.0
 *     responses:
 *       200:
 *         description: Transfer completed successfully
 */

/**
 * @openapi
 * /account/deposit/mock:
 *   post:
 *     summary: Simulate a successful deposit (mock)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Account
 *     responses:
 *       200:
 *         description: Mock deposit successful
 */

/**
 * @openapi
 * /account/withdraw/mock:
 *   post:
 *     summary: Simulate a successful withdrawal (mock)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Account
 *     responses:
 *       200:
 *         description: Mock withdrawal successful
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import * as svc from '../services/accountService.js';


const r = express.Router();


r.get('/summary', requireAuth, async (req,res)=> ok(res, await svc.summary(req.user.id)) );


r.get('/activity', requireAuth, async (req,res)=>{ const limit = Math.min(200, Number(req.query.limit||50)); ok(res, await svc.activity(req.user.id,{ limit })); });


r.post('/transfer', requireAuth, async (req,res)=>{ try{ await svc.transfer(req.user.id, req.body); ok(res,{ transferred:true }); }catch(e){ fail(res,e.message,400);} });


r.post('/deposit/mock', requireAuth, async (req,res)=> ok(res,{ status:'success' }) );


r.post('/withdraw/mock', requireAuth, async (req,res)=> ok(res,{ status:'success' }) );


export default r;