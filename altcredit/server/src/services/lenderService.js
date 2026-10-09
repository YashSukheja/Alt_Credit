const { query, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { anonRef, resolveRefs, incomeBand } = require('../utils/anonymise');
const { scoreProfile } = require('../engine/scorer');
const { getScoringProfile } = require('./userService');
const { logAudit } = require('./auditService');

// Latest stored score per user. DISTINCT ON keeps only the FIRST row per user_id
// after ordering by newest -> exactly "the most recent score of each user".
const LATEST_SCORES_CTE = `
  latest AS (
    SELECT DISTINCT ON (user_id) user_id, score, risk_band, created_at
    FROM credit_scores
    ORDER BY user_id, created_at DESC, score_id DESC
  )`;

const SORTS = {
  score_desc: 'l.score DESC, u.user_id',
  score_asc: 'l.score ASC, u.user_id',
  age_asc: 'u.age ASC, l.score DESC',
};
const BANDS = ['Very Low Risk', 'Low Risk', 'Medium Risk', 'High Risk', 'Very High Risk'];
const EMPLOYMENT = ['Employed', 'Self-Employed', 'Student', 'Unemployed'];

// Same safe pattern as transactions: user input only goes into params, never into SQL text
function buildCandidateFilters(q) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  const int = (v, name, lo, hi) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new AppError(400, 'INVALID_FILTER', `${name} must be a whole number ${lo}-${hi}`);
    return n;
  };

  if (q.minScore !== undefined) add('l.score >= ?', int(q.minScore, 'minScore', 0, 1000));
  if (q.maxScore !== undefined) add('l.score <= ?', int(q.maxScore, 'maxScore', 0, 1000));
  if (q.city_tier !== undefined) add('u.city_tier = ?', int(q.city_tier, 'city_tier', 1, 3));
  if (q.band !== undefined) {
    if (!BANDS.includes(q.band)) throw new AppError(400, 'INVALID_FILTER', `band must be one of ${BANDS.join(', ')}`);
    add('l.risk_band = ?', q.band);
  }
  if (q.employment !== undefined) {
    if (!EMPLOYMENT.includes(q.employment)) throw new AppError(400, 'INVALID_FILTER', `employment must be one of ${EMPLOYMENT.join(', ')}`);
    add('u.employment_status = ?', q.employment);
  }
  if (q.sort !== undefined && !SORTS[q.sort]) {
    throw new AppError(400, 'INVALID_FILTER', `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// GET /lender/candidates -> anonymised, filterable, sortable, paginated list
async function searchCandidates(q, { limit, offset, page }, lender) {
  const { where, params } = buildCandidateFilters(q);
  const order = SORTS[q.sort] || SORTS.score_desc;

  // count(*) OVER () = total matching rows, returned on every row -> one query gives page + total
  const { rows } = await query(
    `WITH ${LATEST_SCORES_CTE}
     SELECT u.user_id, u.age, u.employment_status, u.city_tier, u.monthly_income,
            l.score, l.risk_band, l.created_at AS scored_at,
            count(*) OVER () AS total
     FROM latest l JOIN users u ON u.user_id = l.user_id
     ${where}
     ORDER BY ${order}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  // Which products has THIS lender already offered to these users? (to grey out buttons in the UI)
  const ids = rows.map((r) => r.user_id);
  const offered = ids.length ? (await query(
    'SELECT user_id, product_id, status FROM offers WHERE lender_id = $1 AND user_id = ANY($2)',
    [lender.account_id, ids],
  )).rows : [];

  // Strip identity: user_id is replaced by ref, income becomes a band
  const results = rows.map((r) => ({
    ref: anonRef(r.user_id),
    score: r.score,
    risk_band: r.risk_band,
    age: r.age,
    employment_status: r.employment_status,
    city_tier: r.city_tier,
    income_band: incomeBand(r.monthly_income),
    already_offered: offered.filter((o) => o.user_id === r.user_id)
      .map((o) => ({ product_id: o.product_id, status: o.status })),
  }));

  return { page, limit, total: rows.length ? Number(rows[0].total) : 0, results };
}

async function allUserIds() {
  return (await query('SELECT user_id FROM users')).rows.map((r) => r.user_id);
}

// GET /lender/candidates/:ref -> score breakdown for ONE candidate, still anonymised
async function getCandidate(ref) {
  const { found } = resolveRefs([ref], await allUserIds());
  const userId = found[ref];
  if (!userId) throw new AppError(404, 'CANDIDATE_NOT_FOUND', `No candidate ${ref}`);

  const profile = await getScoringProfile(userId);
  const result = scoreProfile(profile);
  return {
    ref,
    score: result.score,
    risk_band: result.risk_band,
    components: result.components,
    top_positive: result.top_positive,
    top_negative: result.top_negative.map(({ tip, ...f }) => f), // tips are for the user, not the lender
    breakdown: result.breakdown.map(({ key, label, points, max, reason }) => ({ key, label, points, max, reason })),
    profile: {
      age: profile.age,
      employment_status: profile.employment_status,
      city_tier: profile.city_tier,
      income_band: incomeBand(profile.monthly_income),
    },
  };
}

// POST /lender/offers { product_id, refs: [...] } -> push one product to many candidates
async function sendOffers(lender, { product_id: productId, refs } = {}) {
  // 1. Validate input
  if (typeof productId !== 'string' || !productId) throw new AppError(400, 'INVALID_INPUT', 'product_id is required');
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > 100) {
    throw new AppError(400, 'INVALID_INPUT', 'refs must be an array of 1-100 candidate refs');
  }
  const product = (await query('SELECT product_id, product_name, min_score FROM products WHERE product_id = $1', [productId])).rows[0];
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', `No product ${productId}`);

  // 2. Refs -> real user_ids (unknown refs are reported, not fatal)
  const uniqueRefs = [...new Set(refs)];
  const { found, unknown } = resolveRefs(uniqueRefs, await allUserIds());
  const skipped = unknown.map((ref) => ({ ref, reason: 'unknown candidate' }));
  const sent = [];

  // 3. Insert all offers in ONE transaction
  await withTransaction(async (client) => {
    for (const [ref, userId] of Object.entries(found)) {
      // Rule: never offer a product the candidate does not qualify for
      const latest = (await client.query(
        'SELECT score FROM credit_scores WHERE user_id = $1 ORDER BY created_at DESC, score_id DESC LIMIT 1',
        [userId],
      )).rows[0];
      if (!latest) { skipped.push({ ref, reason: 'not scored yet' }); continue; }
      if (latest.score < product.min_score) {
        skipped.push({ ref, reason: `score ${latest.score} is below ${product.min_score}` });
        continue;
      }

      // UNIQUE (user_id, product_id, lender_id) + ON CONFLICT DO NOTHING:
      // sending the same offer twice is harmless (idempotent) -> no duplicates, no crash
      const ins = await client.query(
        `INSERT INTO offers (user_id, product_id, lender_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, product_id, lender_id) DO NOTHING RETURNING offer_id`,
        [userId, product.product_id, lender.account_id],
      );
      if (ins.rowCount === 0) { skipped.push({ ref, reason: 'already offered' }); continue; }
      sent.push({ ref, offer_id: ins.rows[0].offer_id });
    }
  });

  // Audit stores real ids (the audit log is admin-only)
  await logAudit({ actor: lender.username, action: 'OFFER_SENT', entity: 'product', entityId: product.product_id,
    details: { sent: sent.length, skipped: skipped.length, user_ids: sent.map((s) => found[s.ref]) } });

  return { product, sent_count: sent.length, sent, skipped };
}

// GET /lender/offers -> this lender's offers. Identity is revealed ONLY for accepted offers.
async function listLenderOffers(lender, q) {
  const params = [lender.account_id];
  let filter = '';
  if (q.status) {
    if (!['pending', 'accepted', 'rejected', 'revoked'].includes(q.status)) {
      throw new AppError(400, 'INVALID_FILTER', 'status must be pending, accepted, rejected or revoked');
    }
    params.push(q.status);
    filter = 'AND o.status = $2';
  }
  const { rows } = await query(
    `SELECT o.offer_id, o.user_id, o.status, o.created_at, o.responded_at, o.bank_reference,
            p.product_id, p.product_name
     FROM offers o JOIN products p ON p.product_id = o.product_id
     WHERE o.lender_id = $1 ${filter}
     ORDER BY o.created_at DESC, o.offer_id DESC LIMIT 200`,
    params,
  );
  return rows.map(({ user_id: userId, ...o }) => ({
    ...o,
    ref: anonRef(userId),
    user_id: o.status === 'accepted' ? userId : null, // the reveal rule
  }));
}

module.exports = { searchCandidates, getCandidate, sendOffers, listLenderOffers };
