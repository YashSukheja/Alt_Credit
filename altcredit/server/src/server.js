const { port } = require('./config/env');
const app = require('./app');
const { pool } = require('./config/db');
const logger = require('./utils/logger');

const server = app.listen(port, () => {
  logger.info(`AltCredit API listening on http://localhost:${port}`);
});

// Close cleanly on Ctrl+C so DB connections are not left hanging
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});