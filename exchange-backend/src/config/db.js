import mysql from 'mysql2/promise';
import knexfile from '../../knexfile.js';
import { cfg } from '../config.js';

const env = cfg.env || 'development';
const connection = knexfile[env]?.connection ?? knexfile.development.connection;

export const mysqlPool = mysql.createPool({
  host: connection.host,
  port: connection.port,
  user: connection.user,
  password: connection.password,
  database: connection.database,
  ssl: connection.ssl,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  supportBigNumbers: true,
  namedPlaceholders: false,
});
