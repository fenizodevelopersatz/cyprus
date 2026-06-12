const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.TEST_DB_FILE = process.env.TEST_DB_FILE || path.resolve(__dirname, '..', '.test.sqlite');
const testDbFile = process.env.TEST_DB_FILE;

let db;

async function loadDb() {
  const knexfileModule = await import('../knexfile.js');
  const knexfile = knexfileModule.default || knexfileModule;
  const { default: knex } = await import('knex');
  return knex(knexfile.test);
}

beforeAll(async () => {
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }
  db = await loadDb();
  await db.migrate.latest();
});

afterAll(async () => {
  if (db) {
    await db.destroy();
    db = null;
  }
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }
});

beforeEach(async () => {
  await db.raw('PRAGMA foreign_keys = OFF');
  const tables = await db.raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
  const rows = Array.isArray(tables) ? tables : Object.values(tables || []);
  for (const row of rows) {
    const name = row?.name || row?.['name'];
    if (!name || name === 'knex_migrations' || name === 'knex_migrations_lock') continue;
    await db.raw(`DELETE FROM "${name}"`);
  }
  await db.raw('PRAGMA foreign_keys = ON');
});

afterEach(async () => {
  await db.raw('PRAGMA wal_checkpoint(FULL)');
});
