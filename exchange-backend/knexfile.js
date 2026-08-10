import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const base = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
    dateStrings: true,
    supportBigNumbers: true,
  },
  pool: { min: 0, max: 10 },
  migrations: { directory: './db/migrations' },
  seeds: { directory: './db/seeds' },
};

const testConfig = {
  client: 'sqlite3',
  connection: {
    filename: process.env.TEST_DB_FILE || path.resolve(__dirname, '.test.sqlite'),
  },
  useNullAsDefault: true,
  pool: { min: 1, max: 3 },
  migrations: base.migrations,
  seeds: base.seeds,
};

export default {
  development: base,
  test: testConfig,
  production: base,
};