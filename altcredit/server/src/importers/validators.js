// Pure validation functions: one row in, { ok, value, errors } out.
// No database code here, so they are easy to unit test (step 8).

const EDUCATION = ['none', 'highschool', 'cert', 'bachelor', 'master', 'phd'];
const HOUSING = ['owner', 'rent', 'none'];
const TXN_TYPES = ['DEBIT', 'CREDIT'];
const TXN_STATUS = ['Completed', 'Late'];
const CATEGORIES = ['Salary', 'Other Income', 'Rent', 'Utility Bill', 'Food',
  'Transport', 'Shopping', 'Savings'];

const USER_ID_RE = /^USR_\d{3,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Small helpers that collect errors instead of throwing
function makeChecker() {
  const errors = [];
  const add = (field, reason) => errors.push({ field, reason });

  const str = (row, field, { required = true, pattern, oneOf } = {}) => {
    const raw = row[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (required) add(field, 'is missing');
      return null;
    }
    const v = String(raw).trim();
    if (pattern && !pattern.test(v)) add(field, `has invalid format "${v}"`);
    if (oneOf && !oneOf.includes(v)) add(field, `"${v}" is not one of ${oneOf.join(', ')}`);
    return v;
  };

  const num = (row, field, { min, max, integer = false, required = true } = {}) => {
    const raw = row[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (required) add(field, 'is missing');
      return null;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) { add(field, `"${raw}" is not a number`); return null; }
    if (integer && !Number.isInteger(v)) add(field, `${v} must be a whole number`);
    if (min !== undefined && v < min) add(field, `${v} is below minimum ${min}`);
    if (max !== undefined && v > max) add(field, `${v} is above maximum ${max}`);
    return v;
  };

  return { errors, str, num };
}

function result(errors, value) {
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

function validateUser(row) {
  const c = makeChecker();
  const value = {
    user_id: c.str(row, 'user_id', { pattern: USER_ID_RE }),
    applicant_id: c.str(row, 'applicant_id', { pattern: UUID_RE }),
    age: c.num(row, 'age', { min: 18, max: 100, integer: true }),
    education_level: c.str(row, 'education_level', { required: false }),
    employment_status: c.str(row, 'employment_status', { required: false }),
    monthly_income: c.num(row, 'monthly_income', { min: 0 }),
    city_tier: c.num(row, 'city_tier', { min: 1, max: 3, integer: true }),
  };
  return result(c.errors, value);
}

function validateFeatures(row) {
  const c = makeChecker();
  const rate = (f) => c.num(row, f, { min: 0, max: 1 });
  const count = (f) => c.num(row, f, { min: 0, integer: true });
  const value = {
    applicant_id: c.str(row, 'applicant_id', { pattern: UUID_RE }),
    months_at_job: count('months_at_job'),
    housing: c.str(row, 'housing', { oneOf: HOUSING }),
    rent_on_time_months: count('rent_on_time_months'),
    digital_payment_rate: rate('digital_payment_rate'),
    education: c.str(row, 'education', { oneOf: EDUCATION }),
    monthly_spend: c.num(row, 'monthly_spend', { min: 0 }),
    essential_pct: rate('essential_pct'),
    cashflow_volatility: c.num(row, 'cashflow_volatility', { min: 0, max: 5 }),
    savings_days: count('savings_days'),
    on_time_rate: rate('on_time_rate'),
    dti: c.num(row, 'dti', { min: 0, max: 5 }),
    credit_util: c.num(row, 'credit_util', { min: 0, max: 5 }),
    delinq_30plus: count('delinq_30plus'),
    delinq_60plus: count('delinq_60plus'),
    delinq_90plus: count('delinq_90plus'),
    positive_habits: count('positive_habits'),
    risk_flags: count('risk_flags'),
  };
  return result(c.errors, value);
}

// Accepts M/D/YYYY (as in the dataset) or YYYY-MM-DD. Returns 'YYYY-MM-DD' or null.
function parseDate(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  let y; let m; let d;
  let match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) { [, m, d, y] = match.map(Number); } else {
    match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    [, y, m, d] = match.map(Number);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates like 2/30/2023
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function validateTransaction(row) {
  const c = makeChecker();
  const value = {
    transaction_id: c.str(row, 'transaction_id'),
    user_id: c.str(row, 'user_id', { pattern: USER_ID_RE }),
    txn_date: null,
    amount: c.num(row, 'amount', { min: 0.01 }),
    category: c.str(row, 'category', { oneOf: CATEGORIES }),
    type: c.str(row, 'type', { oneOf: TXN_TYPES }),
    status: c.str(row, 'status', { oneOf: TXN_STATUS }),
  };
  if (row.date === undefined || String(row.date).trim() === '') {
    c.errors.push({ field: 'date', reason: 'is missing' });
  } else {
    value.txn_date = parseDate(row.date);
    if (!value.txn_date) c.errors.push({ field: 'date', reason: `"${row.date}" is not a valid date` });
  }
  // Business rule: income categories must be CREDIT, spending must be DEBIT
  const incomeCats = ['Salary', 'Other Income'];
  if (value.category && value.type && incomeCats.includes(value.category) !== (value.type === 'CREDIT')) {
    c.errors.push({ field: 'type', reason: `${value.category} cannot be ${value.type}` });
  }
  return result(c.errors, value);
}

// "17.00% PA" -> { interest_rate: 17, rate_unit: 'PA' }
function parseInterestRate(raw) {
  const match = String(raw || '').match(/^\s*([\d.]+)\s*%\s*([A-Za-z]*)\s*$/);
  if (!match) return null;
  return { interest_rate: Number(match[1]), rate_unit: match[2].toUpperCase() || null };
}

function validateProduct(row) {
  const c = makeChecker();
  const value = {
    product_id: c.str(row, 'product_id'),
    product_name: c.str(row, 'product_name'),
    type: c.str(row, 'type'),
    min_score: c.num(row, 'min_score', { min: 0, max: 1000, integer: true }),
    interest_rate: null,
    rate_unit: null,
  };
  const rate = parseInterestRate(row.interest_rate);
  if (!rate) c.errors.push({ field: 'interest_rate', reason: `"${row.interest_rate}" is not like "12% APR"` });
  else Object.assign(value, rate);
  return result(c.errors, value);
}

module.exports = {
  validateUser, validateFeatures, validateTransaction, validateProduct,
  parseDate, parseInterestRate,
};