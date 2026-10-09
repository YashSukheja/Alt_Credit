// npm run seed:accounts -> creates demo logins. Run AFTER npm run import.
//   admin            (role admin)
//   lender1, lender2 (role lender)
//   usr001 ... usr500 (role user, one per dataset user)
// Passwords come from .env (SEED_*_PASSWORD), never from the code.
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../src/config/db');
const logger = require('../src/utils/logger');

const need = (key) => {
  if (!process.env[key]) throw new Error(`Set ${key} in .env first`);
  return process.env[key];
};

async function main() {
  const adminPw = need('SEED_ADMIN_PASSWORD');
  const lenderPw = need('SEED_LENDER_PASSWORD');
  const userPw = need('SEED_USER_PASSWORD');

  // bcrypt is slow ON PURPOSE (to slow down password guessing).
  // All demo users share one password, so we hash it once and reuse the hash.
  const [adminHash, lenderHash, userHash] = await Promise.all([
    bcrypt.hash(adminPw, 10), bcrypt.hash(lenderPw, 10), bcrypt.hash(userPw, 10),
  ]);

  const { rows: users } = await pool.query('SELECT user_id FROM users ORDER BY user_id');
  if (!users.length) throw new Error('No users found. Run npm run import first.');

  // Upsert: running the script again updates passwords instead of failing
  const upsert = `INSERT INTO accounts (username, password_hash, role, user_id, lender_name)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role, user_id = EXCLUDED.user_id, lender_name = EXCLUDED.lender_name`;

  await withTransaction(async (client) => {
    await client.query(upsert, ['admin', adminHash, 'admin', null, null]);
    await client.query(upsert, ['lender1', lenderHash, 'lender', null, 'FinFirst Bank']);
    await client.query(upsert, ['lender2', lenderHash, 'lender', null, 'MicroCred Finance']);
    for (const { user_id: userId } of users) {
      // USR_001 -> usr001
      await client.query(upsert, [userId.replace('_', '').toLowerCase(), userHash, 'user', userId, null]);
    }
  });
  logger.info('Accounts seeded', { admins: 1, lenders: 2, users: users.length });
}

main()
  .catch((err) => { logger.error('Seeding failed', { error: err.message }); process.exitCode = 1; })
  .finally(() => pool.end());