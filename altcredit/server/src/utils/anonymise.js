const crypto = require('crypto');
const { jwtSecret } = require('../config/env');
const AppError = require('./AppError');

// Lenders must NOT see who a candidate is until the candidate accepts an offer.
// So instead of USR_001 they see a stable pseudonym like "C-3F9A1B2C7D".
// HMAC with a server secret: same user -> same ref every time, but it cannot be reversed
// without the secret (a plain hash of "USR_001" could be guessed by trying all ids).
function anonRef(userId) {
  const digest = crypto.createHmac('sha256', jwtSecret).update(userId).digest('hex');
  return `C-${digest.slice(0, 10).toUpperCase()}`;
}

// Lender sends refs back (e.g. to make offers) -> turn them into real user_ids.
// We compute refs for all known user_ids and look them up (500 users = instant).
function resolveRefs(refs, allUserIds) {
  const byRef = new Map(allUserIds.map((id) => [anonRef(id), id]));
  const found = {};
  const unknown = [];
  for (const ref of refs) {
    const id = byRef.get(ref);
    if (id) found[ref] = id;
    else unknown.push(ref);
  }
  return { found, unknown };
}

// Exact income is sensitive: show a band instead ("5k-10k")
function incomeBand(income) {
  const v = Number(income);
  if (!Number.isFinite(v)) return null;
  if (v < 3000) return 'under 3k';
  if (v < 5000) return '3k-5k';
  if (v < 8000) return '5k-8k';
  if (v < 10000) return '8k-10k';
  return '10k+';
}

function assertRef(ref) {
  if (!/^C-[0-9A-F]{10}$/.test(ref || '')) throw new AppError(400, 'INVALID_REF', `"${ref}" is not a valid candidate ref`);
  return ref;
}

module.exports = { anonRef, resolveRefs, incomeBand, assertRef };