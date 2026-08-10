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
    try {
      fs.unlinkSync(testDbFile);
    } catch (e) {
      // Ignore file locks on Windows; we will wipe the DB via rollback instead
    }
  }
  db = await loadDb();

  // Enable WAL mode for concurrent reads/writes (prevents pool deadlock)
  await db.raw('PRAGMA journal_mode = WAL');
  await db.raw('PRAGMA busy_timeout = 20000');
  
  await db.raw('PRAGMA foreign_keys = OFF');
  const tables = await db.raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
  const rows = Array.isArray(tables) ? tables : Object.values(tables || []);
  for (const row of rows) {
    const name = row?.name || row?.['name'];
    if (name) await db.raw(`DROP TABLE IF EXISTS "${name}"`);
  }
  await db.raw('PRAGMA foreign_keys = ON');
  
  await db.migrate.latest();
});

afterAll(async () => {
  if (db) {
    await db.destroy();
    db = null;
  }
  if (fs.existsSync(testDbFile)) {
    try {
      fs.unlinkSync(testDbFile);
    } catch (e) {
      // Ignore file locks on Windows
    }
  }
});

beforeEach(async () => {
  // Purposefully left empty so state persists sequentially across tests in the same file.
});

afterEach(async () => {
  if (!db) return;
  await db.raw('PRAGMA wal_checkpoint(FULL)');
});
