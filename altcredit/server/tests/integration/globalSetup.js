// Runs ONCE before the integration tests: builds a fresh TEST database.
// Never touches your normal dev database (DATABASE_URL).
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

module.exports = async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('Set TEST_DATABASE_URL in .env (e.g. .../altcredit_test)');
  if (testUrl === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL (setup wipes it)');

  // Same one-command setup as for the demo, pointed at the test DB
  execSync('npm run setup', {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: testUrl, LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
};