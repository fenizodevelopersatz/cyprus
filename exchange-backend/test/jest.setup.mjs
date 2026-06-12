import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDbFile = process.env.TEST_DB_FILE || path.resolve(__dirname, '..', '.test.sqlite');

process.env.NODE_ENV = 'test';
process.env.TEST_DB_FILE = testDbFile;

const knexfileModule = await import('../knexfile.js');
const knexfile = knexfileModule.default || knexfileModule;
const db = knex(knexfile.test);

if (fs.existsSync(testDbFile)) {
  fs.unlinkSync(testDbFile);
}

await db.migrate.latest();

process.on('exit', () => {
  db.destroy();
});
