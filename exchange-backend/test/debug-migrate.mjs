import knexfile from '../knexfile.js';
import knex from 'knex';

const db = knex(knexfile.test);

try {
  console.log('using TEST_DB_FILE', knexfile.test.connection.filename);
  const result = await db.migrate.latest();
  console.log('migrate latest result', result);
  const tables = await db.raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
  console.log('table rows', tables);
  console.log('table row0', tables[0]);
  console.log('table keys', Object.keys(tables));
} catch (error) {
  console.error('ERROR', error);
} finally {
  await db.destroy();
}
