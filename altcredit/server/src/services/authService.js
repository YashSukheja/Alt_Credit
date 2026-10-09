const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { jwtSecret, jwtExpiresIn } = require('../config/env');
const AppError = require('../utils/AppError');
const { logAudit } = require('./auditService');

async function login(username, password) {
  // Basic input check before touching the DB
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new AppError(400, 'INVALID_INPUT', 'username and password are required');
  }

  const { rows } = await query(
    'SELECT account_id, username, password_hash, role, user_id, lender_name FROM accounts WHERE username = $1',
    [username.trim().toLowerCase()],
  );
  const account = rows[0];

  // bcrypt.compare hashes the typed password the same way and compares.
  // We never store or compare plain-text passwords.
  const ok = account ? await bcrypt.compare(password, account.password_hash) : false;

  // Same message for "no such user" and "wrong password",
  // so an attacker cannot find out which usernames exist.
  if (!ok) {
    await logAudit({ actor: username, action: 'LOGIN_FAILED', entity: 'account' });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  }

  // The token carries who you are + your role. It is signed, so it cannot be edited client-side.
  const payload = {
    sub: account.account_id,
    username: account.username,
    role: account.role,
    ...(account.user_id && { user_id: account.user_id }),
    ...(account.lender_name && { lender_name: account.lender_name }),
  };
  const token = jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

  await logAudit({ actor: account.username, action: 'LOGIN_SUCCESS', entity: 'account', entityId: String(account.account_id) });

  // Never send password_hash back
  const { password_hash, ...safeAccount } = account;
  return { token, expires_in: jwtExpiresIn, account: safeAccount };
}

module.exports = { login };