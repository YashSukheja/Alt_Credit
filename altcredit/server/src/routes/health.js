const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

router.get('/', async (req, res) => {
  const startedAt = Date.now();
  let database = 'up';
  try {
    await query('SELECT 1');
  } catch (err) {
    database = 'down';
  }
  const healthy = database === 'up';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    database,
    uptime_seconds: Math.round(process.uptime()),
    response_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;