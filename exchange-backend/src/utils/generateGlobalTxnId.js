import { db } from '../db.js';

const CATEGORY_MAP = new Set([
  'DEP',
  'WDR',
  'COM',
  'SIG',
  'LVL',
  'PKG',
  'ADJ',
  'ADEP',
  'AWDR',
  'REF',
  'TRF',
  'FEE',
  'SWP',
  'BON',
  'RFD',
  'RVS',
]);

function normalizeCategory(category) {
  const next = String(category || '').trim().toUpperCase();
  if (!CATEGORY_MAP.has(next)) {
    throw new Error(`INVALID_TXN_CATEGORY:${category}`);
  }
  return next;
}

async function ensureSequenceTable() {
  const hasTable = await db.schema.hasTable('txn_global_sequence');
  if (!hasTable) {
    await db.schema.createTable('txn_global_sequence', (t) => {
      t.integer('id').primary().notNullable().defaultTo(1);
      t.bigInteger('last_number').notNullable().defaultTo(0);
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  const seed = await db('txn_global_sequence').where({ id: 1 }).first();
  if (!seed) {
    await db('txn_global_sequence').insert({ id: 1, last_number: 0 });
  }
}

export async function generateGlobalTxnId(connection = db, category) {
  const normalizedCategory = normalizeCategory(category);
  await ensureSequenceTable();
  const run = async (runner) => {
    const nextNumber = await allocateGlobalTxnNumber(runner);
    return formatGlobalTxnId(normalizedCategory, nextNumber);
  };

  if (typeof connection?.commit === 'function' && typeof connection?.rollback === 'function') {
    return run(connection);
  }

  return db.transaction(async (trx) => run(trx));
}

export function formatGlobalTxnId(category, number) {
  const normalizedCategory = normalizeCategory(category);
  const safeNumber = Number(number);
  if (!Number.isFinite(safeNumber) || safeNumber < 0) {
    throw new Error('INVALID_TXN_SEQUENCE_NUMBER');
  }
  return `TXN-${normalizedCategory}-${String(Math.trunc(safeNumber)).padStart(6, '0')}`;
}

export async function allocateGlobalTxnNumber(connection = db) {
  await ensureSequenceTable();
  const run = async (runner) => {
    const row = await runner('txn_global_sequence').where({ id: 1 }).forUpdate().first();
    if (!row) {
      throw new Error('TXN_GLOBAL_SEQUENCE_NOT_INITIALIZED');
    }

    const nextNumber = Number(row.last_number || 0) + 1;
    await runner('txn_global_sequence').where({ id: 1 }).update({ last_number: nextNumber });
    return nextNumber;
  };

  if (typeof connection?.commit === 'function' && typeof connection?.rollback === 'function') {
    return run(connection);
  }

  return db.transaction(async (trx) => run(trx));
}
