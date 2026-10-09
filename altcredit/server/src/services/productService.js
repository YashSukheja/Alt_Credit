const { query } = require('../config/db');

// All products, cheapest (lowest min_score) first
async function listProducts() {
  const { rows } = await query(
    'SELECT product_id, product_name, type, min_score, interest_rate, rate_unit FROM products ORDER BY min_score',
  );
  // pg returns NUMERIC as a string ("12.00"), so convert to a real number for the frontend
  return rows.map((p) => ({ ...p, interest_rate: p.interest_rate === null ? null : Number(p.interest_rate) }));
}

// Pure function (no DB): given products and a score, split them into two lists.
// "locked" products also say how many points are still needed -> "15 points away".
function splitByScore(products, score) {
  const eligible = [];
  const locked = [];
  for (const p of products) {
    if (score >= p.min_score) eligible.push(p);
    else locked.push({ ...p, points_away: p.min_score - score });
  }
  return { eligible, locked };
}

// Convenience: load products from DB, then split them for this score
async function productsForScore(score) {
  return splitByScore(await listProducts(), score);
}

module.exports = { listProducts, splitByScore, productsForScore };