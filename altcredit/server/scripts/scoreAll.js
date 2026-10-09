// npm run score:all -> score every user and store results (same as POST /admin/score-all)
const { scoreAllUsers } = require('../src/services/scoreService');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

scoreAllUsers('cli')
  .then((s) => console.log(`Scored ${s.scored} users in ${s.took_ms} ms`, s.by_band))
  .catch((err) => { logger.error('Scoring failed', { error: err.message }); process.exitCode = 1; })
  .finally(() => pool.end());