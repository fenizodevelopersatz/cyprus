import knexfile from '../knexfile.js';
import knex from 'knex';
import { cfg } from './config.js';
import { databaseLogger } from './logging/loggers.js';

const env = cfg.env;
export const db = knex(knexfile[env] || knexfile.development);

db.on('query-error', (error, query) => {
  databaseLogger.error(
    {
      err: error,
      sql: query?.sql,
      bindingsCount: Array.isArray(query?.bindings) ? query.bindings.length : undefined,
    },
    'query_failed'
  );
});

export async function withTx(fn) {
  return db.transaction(async (trx) => fn(trx));
}
