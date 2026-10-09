const { Pool, types } = require('pg');
const { databaseUrl } = require('./env');
const logger = require('../utils/logger');

// Return DATE columns as plain 'YYYY-MM-DD' strings. By default pg turns them into
// JS Dates at local midnight, which shifts the day when converted to UTC.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,                       // at most 10 open connections
  idleTimeoutMillis: 30000,      // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail fast if DB is unreachable
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  logger.debug('db query', { text, ms: Date.now() - start, rows: result.rowCount });
  return result;
}

// For multi-step writes that must all succeed or all fail.
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };