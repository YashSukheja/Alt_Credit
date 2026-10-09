const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { getScoringProfile } = require('./userService');

// Allowed values for the ?category= filter (same list the importer validates against)
const CATEGORIES = ['Salary', 'Other Income', 'Rent', 'Utility Bill', 'Food', 'Transport', 'Shopping', 'Savings'];

// Turns optional query params (?month=&category=&type=&status=) into a SQL WHERE clause.
// User input never goes into the SQL text, only into `params` -> safe from SQL injection.
function buildFilters(userId, q) {
  const where = ['user_id = $1'];  // always filter by the user
  const params = [userId];

  // add('category = ?', 'Rent') -> pushes 'Rent' to params and writes 'category = $2'
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  // Each filter is validated first, so bad input gives a clear 400 instead of a SQL error
  if (q.month) {
    if (!/^\d{4}-\d{2}$/.test(q.month)) throw new AppError(400, 'INVALID_FILTER', 'month must look like 2023-06');
    add("to_char(txn_date, 'YYYY-MM') = ?", q.month);
  }
  if (q.category) {
    if (!CATEGORIES.includes(q.category)) throw new AppError(400, 'INVALID_FILTER', `category must be one of ${CATEGORIES.join(', ')}`);
    add('category = ?', q.category);
  }
  if (q.type) {
    const t = String(q.type).toUpperCase(); // accept "debit" or "DEBIT"
    if (!['DEBIT', 'CREDIT'].includes(t)) throw new AppError(400, 'INVALID_FILTER', 'type must be DEBIT or CREDIT');
    add('type = ?', t);
  }
  if (q.status) {
    if (!['Completed', 'Late'].includes(q.status)) throw new AppError(400, 'INVALID_FILTER', 'status must be Completed or Late');
    add('status = ?', q.status);
  }
  return { where: where.join(' AND '), params };
}

// GET /users/:id/transactions -> one page of transactions + totals for ALL matching rows
async function listTransactions(userId, q, { limit, offset, page }) {
  await getScoringProfile(userId); // 404 for unknown user
  const { where, params } = buildFilters(userId, q);

  // Sort comes from a fixed list (never raw user text in ORDER BY). Default: newest first.
  const sort = q.sort === 'amount_desc' ? 'amount DESC' : q.sort === 'date_asc' ? 'txn_date ASC' : 'txn_date DESC';

  // Two queries run in PARALLEL with Promise.all:
  //  - list:   just the rows for this page (LIMIT/OFFSET)
  //  - totals: counts and sums over every matching row (for "money in / out" cards)
  const [list, totals] = await Promise.all([
    query(
      `SELECT transaction_id, txn_date, amount, category, type, status
       FROM transactions WHERE ${where} ORDER BY ${sort}, transaction_id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    query(
      // FILTER (WHERE ...) = sum only some rows. COALESCE turns "no rows" (NULL) into 0.
      `SELECT count(*)::int AS total,
              COALESCE(sum(amount) FILTER (WHERE type = 'CREDIT'), 0) AS money_in,
              COALESCE(sum(amount) FILTER (WHERE type = 'DEBIT'), 0) AS money_out,
              count(*) FILTER (WHERE status = 'Late')::int AS late_count
       FROM transactions WHERE ${where}`,
      params,
    ),
  ]);

  const t = totals.rows[0];
  return {
    page, limit, total: t.total, // frontend uses total/limit to draw page numbers
    summary: { money_in: Number(t.money_in), money_out: Number(t.money_out), late_payments: t.late_count },
    // amount is NUMERIC -> string from pg, convert to number. txn_date is already 'YYYY-MM-DD' (db.js fix).
    results: list.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
  };
}

module.exports = { listTransactions };