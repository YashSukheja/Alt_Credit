const path = require('path');
const { withTransaction, query } = require('../config/db');
const logger = require('../utils/logger');
const { readJsonArray, readCsv } = require('./readers');
const {
  validateUser, validateFeatures, validateTransaction, validateProduct,
} = require('./validators');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MAX_STORED_ERRORS = 200; // keep import_runs.errors small

const FILES = {
  products: 'product_catalog.json',
  users: 'demographic_data.json',
  features: 'new_age_sample_data.json',
  transactions: 'transactional_data.csv',
};

// Runs a validator over every row and splits good rows from bad ones.
// Row numbers are 1-based; for CSV, row 2 is the first data line.
function validateAll(rows, validator, rowOffset = 1) {
  const good = [];
  const bad = [];
  rows.forEach((row, i) => {
    const r = validator(row);
    if (r.ok) good.push(r.value);
    else bad.push({ row: i + rowOffset, errors: r.errors });
  });
  return { good, bad };
}

// Rejects rows whose key was already seen earlier in the same file
function dropDuplicates(good, bad, key) {
  const seen = new Set();
  return good.filter((v) => {
    if (seen.has(v[key])) {
      bad.push({ row: null, errors: [{ field: key, reason: `duplicate ${key} "${v[key]}"` }] });
      return false;
    }
    seen.add(v[key]);
    return true;
  });
}

function summary(file, total, accepted, bad) {
  return { file, total, accepted, rejected: bad.length, errors: bad.slice(0, MAX_STORED_ERRORS) };
}

// Validate everything first (no DB). Used by the import and by the dry-run script.
function validateDataset(dataDir = DEFAULT_DATA_DIR) {
  const file = (name) => path.join(dataDir, FILES[name]);

  const p = validateAll(readJsonArray(file('products')), validateProduct);
  p.good = dropDuplicates(p.good, p.bad, 'product_id');

  const u = validateAll(readJsonArray(file('users')), validateUser);
  u.good = dropDuplicates(u.good, u.bad, 'user_id');
  const userByApplicant = new Map(u.good.map((x) => [x.applicant_id, x.user_id]));
  const userIds = new Set(u.good.map((x) => x.user_id));

  // Features are keyed by applicant_id; link them to user_id through the users file
  const f = validateAll(readJsonArray(file('features')), validateFeatures);
  f.good = dropDuplicates(f.good, f.bad, 'applicant_id').filter((x) => {
    const userId = userByApplicant.get(x.applicant_id);
    if (!userId) {
      f.bad.push({ row: null, errors: [{ field: 'applicant_id', reason: `no user for applicant ${x.applicant_id}` }] });
      return false;
    }
    x.user_id = userId;
    return true;
  });

  const txRows = readCsv(file('transactions'));
  const t = validateAll(txRows, validateTransaction, 2);
  t.good = dropDuplicates(t.good, t.bad, 'transaction_id').filter((x) => {
    if (!userIds.has(x.user_id)) {
      t.bad.push({ row: null, errors: [{ field: 'user_id', reason: `unknown user ${x.user_id}` }] });
      return false;
    }
    return true;
  });

  return {
    products: { rows: p.good, report: summary(FILES.products, p.good.length + p.bad.length, p.good.length, p.bad) },
    users: { rows: u.good, report: summary(FILES.users, u.good.length + u.bad.length, u.good.length, u.bad) },
    features: { rows: f.good, report: summary(FILES.features, f.good.length + f.bad.length, f.good.length, f.bad) },
    transactions: { rows: t.good, report: summary(FILES.transactions, txRows.length, t.good.length, t.bad) },
  };
}

// UPSERT = insert, or update if the key already exists. Re-running the import is safe.
const SQL = {
  product: `INSERT INTO products (product_id, product_name, type, min_score, interest_rate, rate_unit)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (product_id) DO UPDATE SET product_name=EXCLUDED.product_name, type=EXCLUDED.type,
      min_score=EXCLUDED.min_score, interest_rate=EXCLUDED.interest_rate, rate_unit=EXCLUDED.rate_unit`,
  user: `INSERT INTO users (user_id, applicant_id, age, education_level, employment_status, monthly_income, city_tier)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id) DO UPDATE SET age=EXCLUDED.age, education_level=EXCLUDED.education_level,
      employment_status=EXCLUDED.employment_status, monthly_income=EXCLUDED.monthly_income,
      city_tier=EXCLUDED.city_tier`,
  feature: `INSERT INTO user_features (user_id, months_at_job, housing, rent_on_time_months, digital_payment_rate,
      education, monthly_spend, essential_pct, cashflow_volatility, savings_days, on_time_rate, dti, credit_util,
      delinq_30plus, delinq_60plus, delinq_90plus, positive_habits, risk_flags, source, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'dataset',now())
    ON CONFLICT (user_id) DO UPDATE SET months_at_job=EXCLUDED.months_at_job, housing=EXCLUDED.housing,
      rent_on_time_months=EXCLUDED.rent_on_time_months, digital_payment_rate=EXCLUDED.digital_payment_rate,
      education=EXCLUDED.education, monthly_spend=EXCLUDED.monthly_spend, essential_pct=EXCLUDED.essential_pct,
      cashflow_volatility=EXCLUDED.cashflow_volatility, savings_days=EXCLUDED.savings_days,
      on_time_rate=EXCLUDED.on_time_rate, dti=EXCLUDED.dti, credit_util=EXCLUDED.credit_util,
      delinq_30plus=EXCLUDED.delinq_30plus, delinq_60plus=EXCLUDED.delinq_60plus,
      delinq_90plus=EXCLUDED.delinq_90plus, positive_habits=EXCLUDED.positive_habits,
      risk_flags=EXCLUDED.risk_flags, updated_at=now()`,
  transaction: `INSERT INTO transactions (transaction_id, user_id, txn_date, amount, category, type, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (transaction_id) DO UPDATE SET user_id=EXCLUDED.user_id, txn_date=EXCLUDED.txn_date,
      amount=EXCLUDED.amount, category=EXCLUDED.category, type=EXCLUDED.type, status=EXCLUDED.status`,
};

async function importDataset({ dataDir = DEFAULT_DATA_DIR, actor = 'system' } = {}) {
  const started = Date.now();
  const v = validateDataset(dataDir);

  // One DB transaction: either every valid row is saved, or nothing is.
  await withTransaction(async (client) => {
    for (const p of v.products.rows) {
      await client.query(SQL.product, [p.product_id, p.product_name, p.type, p.min_score, p.interest_rate, p.rate_unit]);
    }
    for (const u of v.users.rows) {
      await client.query(SQL.user, [u.user_id, u.applicant_id, u.age, u.education_level,
        u.employment_status, u.monthly_income, u.city_tier]);
    }
    for (const f of v.features.rows) {
      await client.query(SQL.feature, [f.user_id, f.months_at_job, f.housing, f.rent_on_time_months,
        f.digital_payment_rate, f.education, f.monthly_spend, f.essential_pct, f.cashflow_volatility,
        f.savings_days, f.on_time_rate, f.dti, f.credit_util, f.delinq_30plus, f.delinq_60plus,
        f.delinq_90plus, f.positive_habits, f.risk_flags]);
    }
    for (const t of v.transactions.rows) {
      await client.query(SQL.transaction, [t.transaction_id, t.user_id, t.txn_date, t.amount,
        t.category, t.type, t.status]);
    }

    for (const key of ['products', 'users', 'features', 'transactions']) {
      const r = v[key].report;
      await client.query(
        'INSERT INTO import_runs (file_name, total, accepted, rejected, errors) VALUES ($1,$2,$3,$4,$5)',
        [r.file, r.total, r.accepted, r.rejected, JSON.stringify(r.errors)],
      );
    }
  });

  const reports = ['products', 'users', 'features', 'transactions'].map((k) => {
    const { errors, ...counts } = v[k].report;
    return { ...counts, sample_errors: errors.slice(0, 5) };
  });
  const tookMs = Date.now() - started;

  await query(
    'INSERT INTO audit_log (actor, action, entity, details) VALUES ($1, $2, $3, $4)',
    [actor, 'IMPORT_COMPLETED', 'dataset', JSON.stringify({ reports: reports.map(({ sample_errors, ...r }) => r), took_ms: tookMs })],
  );
  logger.info('Dataset import finished', { took_ms: tookMs, reports: reports.map(({ sample_errors, ...r }) => r) });
  return { took_ms: tookMs, files: reports };
}

module.exports = { importDataset, validateDataset, validateAll, FILES };