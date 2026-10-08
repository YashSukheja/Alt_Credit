const { query } = require('../config/db');
const AppError = require('../utils/AppError');

// Loads everything the scoring engine needs for ONE user:
// demographics (incl. monthly_income) from `users` + behaviour from `user_features`.
async function getScoringProfile(userId) {
  // LEFT JOIN: we still get the user row even if they have no features yet.
  // The engine then scores missing fields as 0 instead of crashing.
  const { rows } = await query(
    `SELECT u.user_id, u.age, u.education_level, u.employment_status, u.monthly_income, u.city_tier,
            f.months_at_job, f.housing, f.rent_on_time_months, f.digital_payment_rate, f.education,
            f.monthly_spend, f.essential_pct, f.cashflow_volatility, f.savings_days, f.on_time_rate,
            f.dti, f.credit_util, f.delinq_30plus, f.delinq_60plus, f.delinq_90plus,
            f.positive_habits, f.risk_flags, f.source
     FROM users u LEFT JOIN user_features f ON f.user_id = u.user_id
     WHERE u.user_id = $1`,  // $1 = placeholder, pg fills it safely (no SQL injection)
    [userId],
  );

  // No row = user does not exist -> errorHandler turns this into a clean 404 response
  if (!rows.length) throw new AppError(404, 'USER_NOT_FOUND', `No user ${userId}`);
  return rows[0];
}

module.exports = { getScoringProfile };