const AppError = require('./AppError');

const USER_ID_RE = /^USR_\d{3,}$/;

function assertUserId(userId) {
  if (!USER_ID_RE.test(userId || '')) {
    throw new AppError(400, 'INVALID_USER_ID', `"${userId}" is not a valid user id (expected like USR_001)`);
  }
  return userId;
}

// ?page=2&limit=20 -> { limit, offset, page } with safe bounds
function parsePagination(q, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { assertUserId, parsePagination, USER_ID_RE };