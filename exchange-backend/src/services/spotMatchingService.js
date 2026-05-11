import { parseUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { journal } from './ledgerService.js';
import { symbolMeta } from '../utils/symbols.js';
import { getSettings } from './settingsService.js';
import { sendSpotTradeEmail } from './mailService.js';
import { getUserContact } from './userService.js';

const UNIT = 10n ** 18n;
const HOUSE_SPOT_NAMESPACE = 'spot:inventory';

function toBig(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0n;
  return parseUnits(num.toFixed(8), 18);
}

async function fillOrder(order, { fillPrice }) {
  const meta = symbolMeta[order.symbol];
  if (!meta) return false;
  const baseAsset = meta.base;
  const quoteAsset = meta.quote;
  const quantityBig = toBig(order.size);
  if (quantityBig <= 0n) return false;
  const priceValue = Number(fillPrice ?? order.price ?? 0);
  if (!Number.isFinite(priceValue) || priceValue <= 0) return false;
  const priceBig = parseUnits(priceValue.toFixed(8), 18);
  const notionalBig = (quantityBig * priceBig) / UNIT;
  const now = new Date();
  const takerFeeFraction = await loadTakerFeeFraction();
  const feeBaseValue = order.side === 'BUY' ? Number(order.size) * takerFeeFraction : 0;
  const feeQuoteValue = Number(order.size) * priceValue * takerFeeFraction;
  const feeBaseBig = toBig(feeBaseValue);
  const feeQuoteBig = toBig(feeQuoteValue);

  const filled = await withTx(async (trx) => {
    const fresh = await trx('spot_orders').where({ id: order.id, status: 'NEW' }).forUpdate().first();
    if (!fresh) return false;

    if (order.side === 'BUY') {
      await journal(
        trx,
        [
          {
            account: { userId: order.user_id, namespace: 'spot:locked', asset: quoteAsset },
            amount: -notionalBig,
            meta: { action: 'release_buy', orderId: order.id },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: quoteAsset },
            amount: notionalBig,
            meta: { action: 'fill_buy', orderId: order.id },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: baseAsset },
            amount: -quantityBig,
            meta: { action: 'fill_buy', orderId: order.id },
          },
          {
            account: { userId: order.user_id, namespace: 'spot:available', asset: baseAsset },
            amount: quantityBig,
            meta: { action: 'fill_buy', orderId: order.id },
          },
          ...(feeBaseBig > 0n
            ? [
                {
                  account: { userId: order.user_id, namespace: 'spot:available', asset: baseAsset },
                  amount: -feeBaseBig,
                  meta: { action: 'taker_fee', orderId: order.id },
                },
                {
                  account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: baseAsset },
                  amount: feeBaseBig,
                  meta: { action: 'taker_fee', orderId: order.id },
                },
              ]
            : []),
        ],
        { description: `Spot BUY fill ${order.symbol}`, meta: { orderId: order.id } }
      );
    } else {
      await journal(
        trx,
        [
          {
            account: { userId: order.user_id, namespace: 'spot:locked', asset: baseAsset },
            amount: -quantityBig,
            meta: { action: 'release_sell', orderId: order.id },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: baseAsset },
            amount: quantityBig,
            meta: { action: 'fill_sell', orderId: order.id },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: quoteAsset },
            amount: -notionalBig,
            meta: { action: 'fill_sell', orderId: order.id },
          },
          {
            account: { userId: order.user_id, namespace: 'spot:available', asset: quoteAsset },
            amount: notionalBig,
            meta: { action: 'fill_sell', orderId: order.id },
          },
          ...(feeQuoteBig > 0n
            ? [
                {
                  account: { userId: order.user_id, namespace: 'spot:available', asset: quoteAsset },
                  amount: -feeQuoteBig,
                  meta: { action: 'taker_fee', orderId: order.id },
                },
                {
                  account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: quoteAsset },
                  amount: feeQuoteBig,
                  meta: { action: 'taker_fee', orderId: order.id },
                },
              ]
            : []),
        ],
        { description: `Spot SELL fill ${order.symbol}`, meta: { orderId: order.id } }
      );
    }

    await trx('spot_orders')
      .where({ id: order.id })
      .update({
        status: 'FILLED',
        filled: order.size,
        updated_at: now,
      });

    await trx('spot_trades').insert({
      order_id: order.id,
      match_id: null,
      price: Number(priceValue).toFixed(8),
      size: Number(order.size).toFixed(8),
      fee: Number(feeQuoteValue).toFixed(8),
      created_at: now,
      updated_at: now,
    });

    return true;
  });

  if (filled) {
    try {
      const trade = await db('spot_trades')
        .where({ order_id: order.id })
        .orderBy('id', 'desc')
        .first();
      const contact = await getUserContact(order.user_id);
      if (contact?.email && trade) {
        await sendSpotTradeEmail({
          to: contact.email,
          name: contact.name,
          symbol: order.symbol,
          side: order.side,
          price: Number(trade.price || fillPrice).toFixed(8),
          quantity: Number(trade.size || order.size || 0),
          fee: Number(trade.fee || 0).toFixed(8),
          feeAsset: order.side === 'BUY' ? baseAsset : quoteAsset,
        });
      }
    } catch (err) {
      console.error('[mail] spot trade email failed', err.message);
    }
  }

  return filled;
}

async function loadTakerFeeFraction() {
  try {
    const settings = await getSettings();
    const pct = Number(settings.tradeTakerFee || 0);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return pct / 100;
  } catch {
    return 0;
  }
}

export async function matchSpotOrders(symbol, marketPrice) {
  if (!Number.isFinite(marketPrice)) return;
  const rows = await db('spot_orders')
    .where({ symbol, status: 'NEW' })
    .andWhere((builder) => {
      builder
        .where(function () {
          this.where('side', 'BUY').andWhere('price', '>=', marketPrice);
        })
        .orWhere(function () {
          this.where('side', 'SELL').andWhere('price', '<=', marketPrice);
        });
    })
    .orderBy('created_at', 'asc')
    .limit(25);

  for (const row of rows) {
    try {
      await fillOrder(row, { fillPrice: marketPrice });
    } catch (err) {
      console.error('[spotMatcher] fill error', row.id, err.message);
    }
  }
}
