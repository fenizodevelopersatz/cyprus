import knex from 'knex';
import util from 'node:util';

const db = knex({
  client: 'sqlite3',
  connection: {
    filename: ':memory:',
  },
  useNullAsDefault: true,
});

try {
  await db.raw('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
  await db.raw('CREATE UNIQUE INDEX users_name_unique ON users(name)');

  const tables = await db.raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
  console.log('TABLES TYPE', typeof tables);
  console.log('TABLES IS_ARRAY', Array.isArray(tables));
  console.log('TABLES LENGTH', tables.length);
  console.log('TABLES KEYS', Object.keys(tables));
  console.log('TABLES', util.inspect(tables, {depth: 4}));
  console.log('TABLES[0]', util.inspect(tables[0], {depth: 4}));

  const idx = await db.raw("PRAGMA index_list('users')");
  console.log('IDX TYPE', typeof idx);
  console.log('IDX IS_ARRAY', Array.isArray(idx));
  console.log('IDX LENGTH', idx.length);
  console.log('IDX KEYS', Object.keys(idx));
  console.log('IDX', util.inspect(idx, {depth: 4}));
  console.log('IDX[0]', util.inspect(idx[0], {depth: 4}));
} catch (error) {
  console.error('ERROR', error);
} finally {
  await db.destroy();
}
