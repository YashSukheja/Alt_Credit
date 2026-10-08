// Creates all tables. WARNING: drops existing tables first (dev only).
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  logger.info('Schema created', { tables: rows.map((r) => r.table_name) });
}

main()
  .catch((err) => {
    logger.error('Schema creation failed', { error: err.message });
    process.exitCode = 1;
  })
  .finally(() => pool.end());