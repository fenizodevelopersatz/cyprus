import 'dotenv/config';


const base = {
client: 'mysql2',
connection: {
host: process.env.DB_HOST,
port: process.env.DB_PORT || 3306,
user: process.env.DB_USER,
password: process.env.DB_PASS,
database: process.env.DB_NAME,
 ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false } // or provide CA if you have one
    : false,
dateStrings: true,
supportBigNumbers: true
},
pool: { min: 0, max: 10 },
migrations: { directory: './db/migrations' },
seeds: { directory: './db/seeds' }
};


export default {
development: base,
test: { ...base, connection: { ...base.connection, database: process.env.TEST_DB || 'novax_test' } },
production: base
};