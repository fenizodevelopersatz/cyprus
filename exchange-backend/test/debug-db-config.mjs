import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_FILE = process.env.TEST_DB_FILE || new URL('../.test.sqlite', import.meta.url).pathname;

const { cfg } = await import('../src/config.js');
const { db } = await import('../src/db.js');
console.log('NODE_ENV', process.env.NODE_ENV);
console.log('TEST_DB_FILE', process.env.TEST_DB_FILE);
console.log('cfg.env', cfg.env);
console.log('db client', db.client.config.client);
console.log('db filename', db.client.config.connection.filename);
await db.destroy();
