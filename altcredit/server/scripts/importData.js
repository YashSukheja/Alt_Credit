// npm run import            -> validate + load data/ into PostgreSQL
const { importDataset } = require('../src/importers/importDataset');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

importDataset({ actor: 'cli' })
  .then((r) => console.table(r.files.map(({ sample_errors, ...x }) => x)))
  .catch((err) => { logger.error('Import failed', { error: err.message }); process.exitCode = 1; })
  .finally(() => pool.end());