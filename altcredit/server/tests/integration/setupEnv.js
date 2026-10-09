// Runs before each integration test file, BEFORE the app is required:
// point the app at the test database and keep logs quiet.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.LOG_LEVEL = 'error';