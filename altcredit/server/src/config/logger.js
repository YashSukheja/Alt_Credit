const { logLevel } = require('../config/env');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[logLevel] ?? LEVELS.info;

function log(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = {
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...(meta && { meta }),
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};