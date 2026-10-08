// npm run score:user -- USR_001   -> prints the score breakdown for one user from the DB
const { query, pool } = require('../src/config/db');
const { scoreProfile } = require('../src/engine/scorer');

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error('Usage: npm run score:user -- USR_001');
  const { rows } = await query(
    `SELECT f.*, u.monthly_income FROM user_features f
     JOIN users u ON u.user_id = f.user_id WHERE f.user_id = $1`, [userId],
  );
  if (!rows.length) throw new Error(`No features for ${userId}. Did you run npm run import?`);

  const r = scoreProfile(rows[0]);
  console.log(`\n${userId}: ${r.score} / 1000  (${r.risk_band}, raw ${r.raw_points})\n`);
  console.table(r.breakdown.map((f) => ({ code: f.code, factor: f.label, points: `${f.points}/${f.max}`, reason: f.reason })));
  console.log('\nTo improve:');
  r.top_negative.filter((f) => f.tip).forEach((f) => console.log(`  - ${f.tip} (${f.label})`));
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => pool.end());