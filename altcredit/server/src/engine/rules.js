// The AltCredit rule table from the problem statement, written as data.
// Each factor: where its value comes from, and bands checked top to bottom.
// The first band whose test passes gives the points.
//
// Pure data + small functions: no database, no Express.

const pct = (v) => `${Math.round(v * 100)}%`;

const FACTORS = [
  // ---------- 1. Lifestyle (max 350) ----------
  {
    key: 'employment_stability', code: '1.1', component: 'Lifestyle',
    label: 'Employment stability', max: 150,
    value: (p) => p.months_at_job,
    format: (v) => `${v} months at current job`,
    bands: [
      { points: 150, test: (v) => v >= 24, need: '24+ months' },
      { points: 100, test: (v) => v >= 12, need: '12+ months' },
      { points: 50, test: (v) => v >= 6, need: '6+ months' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'housing_status', code: '1.2', component: 'Lifestyle',
    label: 'Housing status', max: 80,
    value: (p) => (p.housing == null ? null : { housing: p.housing, months: p.rent_on_time_months ?? 0 }),
    format: (v) => (v.housing === 'rent' ? `Renting, ${v.months} months paid on time` : v.housing === 'owner' ? 'Owns home' : 'No stable address'),
    bands: [
      { points: 80, test: (v) => v.housing === 'owner', need: 'home ownership' },
      { points: 60, test: (v) => v.housing === 'rent' && v.months >= 12, need: '12+ months of on-time rent' },
      { points: 30, test: (v) => v.housing === 'rent', need: 'a rental with payment history' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'digital_footprint', code: '1.3', component: 'Lifestyle',
    label: 'Digital footprint (bills paid on time)', max: 70,
    value: (p) => p.digital_payment_rate,
    format: (v) => `${pct(v)} of mobile/internet bills on time`,
    bands: [
      { points: 70, test: (v) => v >= 0.95, need: '95%+ on time' },
      { points: 45, test: (v) => v >= 0.80, need: '80%+ on time' },
      { points: 20, test: (v) => v >= 0.60, need: '60%+ on time' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'education', code: '1.4', component: 'Lifestyle',
    label: 'Education / skill level', max: 50,
    value: (p) => p.education,
    format: (v) => ({ phd: 'PhD', master: "Master's", bachelor: "Bachelor's", cert: 'Professional certificate', highschool: 'High school', none: 'Below high school' }[v] || v),
    bands: [
      { points: 50, test: (v) => v === 'master' || v === 'phd', need: "a Master's degree" },
      { points: 40, test: (v) => v === 'bachelor', need: "a Bachelor's degree" },
      { points: 30, test: (v) => v === 'cert', need: 'a professional certificate' },
      { points: 20, test: (v) => v === 'highschool', need: 'high school completion' },
      { points: 0, test: () => true },
    ],
  },

  // ---------- 2. Spending behaviour (max 350) ----------
  {
    key: 'spend_to_income', code: '2.1', component: 'Spending',
    label: 'Spend-to-income ratio', max: 120,
    value: (p) => (p.monthly_spend == null || !p.monthly_income ? null : p.monthly_spend / p.monthly_income),
    format: (v) => `Spends ${pct(v)} of monthly income`,
    bands: [
      { points: 120, test: (v) => v <= 0.30, need: 'spending at or below 30% of income' },
      { points: 80, test: (v) => v <= 0.50, need: 'spending at or below 50% of income' },
      { points: 40, test: (v) => v <= 0.70, need: 'spending at or below 70% of income' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'expense_diversity', code: '2.2', component: 'Spending',
    label: 'Essential vs discretionary spending', max: 80,
    value: (p) => p.essential_pct,
    format: (v) => `${pct(v)} of spending on essentials`,
    bands: [
      { points: 80, test: (v) => v >= 0.70, need: '70%+ of spending on essentials' },
      { points: 45, test: (v) => v >= 0.55, need: '55%+ of spending on essentials' },
      { points: 20, test: (v) => v >= 0.40, need: '40%+ of spending on essentials' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'cashflow_volatility', code: '2.3', component: 'Spending',
    label: 'Cash-flow volatility', max: 70,
    value: (p) => p.cashflow_volatility,
    format: (v) => `Monthly cash flow varies by ${pct(v)} of income`,
    bands: [
      { points: 70, test: (v) => v <= 0.05, need: 'volatility at or below 5%' },
      { points: 40, test: (v) => v <= 0.10, need: 'volatility at or below 10%' },
      { points: 15, test: (v) => v <= 0.20, need: 'volatility at or below 20%' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'savings_buffer', code: '2.4', component: 'Spending',
    label: 'Savings / emergency fund', max: 80,
    value: (p) => p.savings_days,
    format: (v) => `${v} days of income saved`,
    bands: [
      { points: 80, test: (v) => v >= 180, need: '180+ days of income saved' },
      { points: 50, test: (v) => v >= 90, need: '90+ days of income saved' },
      { points: 20, test: (v) => v >= 30, need: '30+ days of income saved' },
      { points: 0, test: () => true },
    ],
  },

  // ---------- 3. Repayment discipline (max 570) ----------
  {
    key: 'on_time_payments', code: '3.1', component: 'Repayment',
    label: 'On-time payment rate', max: 200,
    value: (p) => p.on_time_rate,
    format: (v) => `${pct(v)} of payments made on time`,
    bands: [
      { points: 200, test: (v) => v >= 0.98, need: '98%+ on-time payments' },
      { points: 150, test: (v) => v >= 0.95, need: '95%+ on-time payments' },
      { points: 100, test: (v) => v >= 0.90, need: '90%+ on-time payments' },
      { points: 50, test: (v) => v >= 0.80, need: '80%+ on-time payments' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'debt_to_income', code: '3.2', component: 'Repayment',
    label: 'Debt-to-income ratio', max: 120,
    value: (p) => p.dti,
    format: (v) => `Debt payments are ${pct(v)} of income`,
    bands: [
      { points: 120, test: (v) => v <= 0.20, need: 'debt at or below 20% of income' },
      { points: 80, test: (v) => v <= 0.35, need: 'debt at or below 35% of income' },
      { points: 40, test: (v) => v <= 0.50, need: 'debt at or below 50% of income' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'credit_utilization', code: '3.3', component: 'Repayment',
    label: 'Credit utilization', max: 100,
    value: (p) => p.credit_util,
    format: (v) => `Using ${pct(v)} of available credit`,
    bands: [
      { points: 100, test: (v) => v <= 0.10, need: 'utilization at or below 10%' },
      { points: 70, test: (v) => v <= 0.30, need: 'utilization at or below 30%' },
      { points: 30, test: (v) => v <= 0.50, need: 'utilization at or below 50%' },
      { points: 0, test: () => true },
    ],
  },
  {
    key: 'delinquency', code: '3.4', component: 'Repayment',
    label: 'Recent missed payments', max: 150,
    // All three missing = no data (scored 0). Some missing = treat those as 0 misses.
    value: (p) => {
      if (p.delinq_30plus == null && p.delinq_60plus == null && p.delinq_90plus == null) return null;
      return { d30: p.delinq_30plus ?? 0, d60: p.delinq_60plus ?? 0, d90: p.delinq_90plus ?? 0 };
    },
    format: (v) => {
      const total = v.d30 + v.d60 + v.d90;
      if (total === 0) return 'No missed payments in 24 months';
      return `${total} missed payment(s): ${v.d30}×30-day, ${v.d60}×60-day, ${v.d90}×90-day+`;
    },
    bands: [
      { points: 150, test: (v) => v.d30 + v.d60 + v.d90 === 0, need: 'no missed payments' },
      { points: 100, test: (v) => v.d30 === 1 && v.d60 === 0 && v.d90 === 0, need: 'at most one 30-day miss' },
      { points: 50, test: (v) => v.d60 === 1 && v.d30 === 0 && v.d90 === 0, need: 'at most one 60-day miss' },
      { points: 0, test: () => true },
    ],
  },
];

// ---------- 4. Bonus / penalty adjustments ----------
const ADJUSTMENTS = [
  {
    key: 'positive_habits', code: '4.1', component: 'Adjustments',
    label: 'Positive financial habits', max: 50,
    value: (p) => p.positive_habits ?? 0,
    points: (v) => Math.min(20 * Math.min(v, 3), 50),
    format: (v) => `${v} positive habit(s) (e.g. regular savings app deposits)`,
  },
  {
    key: 'risk_flags', code: '4.2', component: 'Adjustments',
    label: 'Risk flags', max: 0, min: -50,
    value: (p) => p.risk_flags ?? 0,
    points: (v) => -Math.min(20 * v, 50),
    format: (v) => `${v} risk flag(s) (e.g. recent address change, many credit enquiries)`,
  },
];

// Risk bands aligned to the product catalogue thresholds
const RISK_BANDS = [
  { min: 750, band: 'Very Low Risk', color: 'green' },
  { min: 650, band: 'Low Risk', color: 'lightgreen' },
  { min: 550, band: 'Medium Risk', color: 'yellow' },
  { min: 350, band: 'High Risk', color: 'orange' },
  { min: 0, band: 'Very High Risk', color: 'red' },
];

const MAX_SCORE = 1000;
const RULE_VERSION = 'v1';

module.exports = { FACTORS, ADJUSTMENTS, RISK_BANDS, MAX_SCORE, RULE_VERSION };