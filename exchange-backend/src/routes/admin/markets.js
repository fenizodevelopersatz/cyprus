import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok } from '../../utils/responses.js';
import { db } from '../../db.js';
import { futuresLimits } from '../../utils/symbols.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

function decimalPlaces(value) {
  const text = String(value || '');
  if (!text.includes('.')) return 0;
  return text.length - text.indexOf('.') - 1;
}

router.get('/', guard, async (_req, res) => {
  const rows = await db('market_symbols').orderBy('symbol');
  ok(
    res,
    rows.map((row) => ({
      symbol: row.symbol,
      baseAsset: row.base_asset,
      quoteAsset: row.quote_asset,
      tickSize: Number(row.tick_size || 0),
      lotSize: Number(row.lot_size || 0),
      basePrecision: decimalPlaces(row.lot_size || 0),
      quotePrecision: decimalPlaces(row.tick_size || 0),
      status: row.contract_type ? 'perp' : 'spot',
      contractType: row.contract_type || 'spot',
      isEnabled: row.is_enabled === null || row.is_enabled === undefined ? true : Boolean(row.is_enabled),
      minLeverage:
        row.contract_type === 'perp'
          ? Number(row.min_leverage || futuresLimits.minLev)
          : Number(row.min_leverage || 1),
      maxLeverage:
        row.contract_type === 'perp'
          ? Number(row.max_leverage || futuresLimits.maxLev)
          : Number(row.max_leverage || 1),
    }))
  );
});

export default router;
