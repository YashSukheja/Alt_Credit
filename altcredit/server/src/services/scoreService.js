const { query, withTransaction } = require('../config/db');
const { scoreProfile } = require('../engine/scorer');
const { getScoringProfile } = require('./userService');
const { productsForScore } = require('./productService');
const { logAudit } = require('./auditService');
const logger = require('../utils/logger');

// Most recent saved score for a user (or null if never scored).
// Works with the normal pool OR inside a transaction (when `client` is passed).
async function latestSavedScore(userId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT score_id, score, raw_points, risk_band, rule_version, created_at
     FROM credit_scores WHERE user_id = $1 ORDER BY created_at DESC, score_id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

// Main "what is my score?" function used by GET /users/:id/score
async function getCurrentScore(userId, actor) {
  // 1. Load data and run the pure engine
  const profile = await getScoringProfile(userId);
  const result = scoreProfile(profile);
  const latest = await latestSavedScore(userId);

  // 2. Save to history ONLY if something changed (first time, new score, or new rule version).
  //    Refreshing the page 10 times should not create 10 identical history rows.
  let saved = false;
  if (!latest || latest.score !== result.score || latest.raw_points !== result.raw_points
      || latest.rule_version !== result.rule_version) {
    await query(
      `INSERT INTO credit_scores (user_id, score, raw_points, risk_band, breakdown, rule_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      // breakdown is stored as JSONB so the PDF/report can show exactly what the user saw
      [userId, result.score, result.raw_points, result.risk_band, JSON.stringify(result.breakdown), result.rule_version],
    );
    saved = true;

    // 3. Record who triggered it and how the score moved
    await logAudit({ actor, action: 'SCORE_CALCULATED', entity: 'user', entityId: userId,
      details: { score: result.score, previous: latest ? latest.score : null } });
  }

  // 4. Attach eligible / locked products and send everything back
  const products = await productsForScore(result.score);
  return {
    user_id: userId,
    ...result,                                             // score, band, breakdown, top factors...
    previous_score: latest && saved ? latest.score : null, // lets the UI show "↑ +20 since last time"
    products,
    calculated_at: new Date().toISOString(),
  };
}

// Score timeline for one user (newest first)
async function getScoreHistory(userId) {
  await getScoringProfile(userId); // just to throw 404 if the user does not exist
  const { rows } = await query(
    `SELECT score, raw_points, risk_band, rule_version, created_at
     FROM credit_scores WHERE user_id = $1 ORDER BY created_at DESC, score_id DESC LIMIT 50`,
    [userId],
  );
  return rows;
}

// Admin: score every user in one go.
// Needed so the lender search (step 5) can filter on STORED scores with fast SQL.
async function scoreAllUsers(actor) {
  const started = Date.now();

  // 1. One query loads all 500 profiles (much faster than 500 separate queries)
  const { rows } = await query(
    `SELECT u.user_id, u.monthly_income, f.* FROM users u JOIN user_features f ON f.user_id = u.user_id`,
  );
  // 2. Engine is pure + fast: 500 users in ~30 ms
  const results = rows.map((r) => ({ user_id: r.user_id, ...scoreProfile(r) }));

  // 3. Save inside ONE transaction: all history rows are written, or none are
  let inserted = 0;
  await withTransaction(async (client) => {
    for (const r of results) {
      const latest = await latestSavedScore(r.user_id, client);
      // Same "only if changed" rule as above -> running score-all twice adds 0 rows
      if (latest && latest.score === r.score && latest.raw_points === r.raw_points
          && latest.rule_version === r.rule_version) continue;
      await client.query(
        `INSERT INTO credit_scores (user_id, score, raw_points, risk_band, breakdown, rule_version)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.user_id, r.score, r.raw_points, r.risk_band, JSON.stringify(r.breakdown), r.rule_version],
      );
      inserted += 1;
    }
  });

  // 4. Count users per risk band -> nice summary for the admin dashboard
  const bands = {};
  results.forEach((r) => { bands[r.risk_band] = (bands[r.risk_band] || 0) + 1; });
  const summary = { scored: results.length, new_history_rows: inserted, by_band: bands, took_ms: Date.now() - started };

  await logAudit({ actor, action: 'SCORE_ALL', entity: 'dataset', details: summary });
  logger.info('Scored all users', summary);
  return summary;
}

module.exports = { getCurrentScore, getScoreHistory, scoreAllUsers, latestSavedScore };