require('dotenv').config();

// Stop at startup if something essential is missing (better than failing mid-demo)
const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h', // how long a login token stays valid
  logLevel: process.env.LOG_LEVEL || 'info',
   // Partner bank (step 7). Optional at startup: only "accept offer" needs it.
  bankApiUrl: process.env.BANK_API_URL || 'http://localhost:5001',
  bankApiKey: process.env.BANK_API_KEY || '',
  bankTimeoutMs: Number(process.env.BANK_TIMEOUT_MS) || 5000,
};