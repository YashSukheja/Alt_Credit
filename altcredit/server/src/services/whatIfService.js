const AppError = require('../utils/AppError');
const { scoreProfile } = require('../engine/scorer');
const { getScoringProfile } = require('./userService');
const { productsForScore } = require('./productService');
const { logAudit } = require('./auditService');

// WHITELIST: the only fields a user may change in the simulator, with allowed ranges.
// Anything not listed here (user_id, age, ...) is rejected.
const EDITABLE = {
  months_at_job: { min: 0, max: 600, integer: true },
  housing: { oneOf: ['owner', 'rent', 'none'] },
  rent_on_time_months: { min: 0, max: 600, integer: true },
  digital_payment_rate: { min: 0, max: 1 },        // rates are 0..1 (0.95 = 95%)
  education: { oneOf: ['none', 'highschool', 'cert', 'bachelor', 'master', 'phd'] },
  monthly_income: { min: 0, max: 10000000 },
  monthly_spend: { min: 0, max: 10000000 },
  essential_pct: { min: 0, max: 1 },
  cashflow_volatility: { min: 0, max: 5 },
  savings_days: { min: 0, max: 3650, integer: true },
  on_time_rate: { min: 0, max: 1 },
  dti: { min: 0, max: 5 },
  credit_util: { min: 0, max: 5 },
  delinq_30plus: { min: 0, max: 50, integer: true },
  delinq_60plus: { min: 0, max: 50, integer: true },
  delinq_90plus: { min: 0, max: 50, integer: true },
  positive_habits: { min: 0, max: 10, integer: true },
  risk_flags: { min: 0, max: 10, integer: true },
};

// Small helpers: null-safe number, keep a value inside a range, round to 2 decimals
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

// The 4 scenarios from the problem statement, as presets.
// Each `apply` takes the current profile and returns ONLY the fields it changes.
const SCENARIOS = {
  // "What if I save extra Rs X for the next N months?"
  save_extra: {
    label: 'Save extra money every month',
    apply: (p, { amount = 1000, months = 3 } = {}) => {
      // Convert money saved into "days of income": Rs 3000 extra / (income per day)
      const dailyIncome = num(p.monthly_income) / 30;
      const extraDays = dailyIncome > 0 ? Math.round((amount * months) / dailyIncome) : 0;
      return {
        savings_days: num(p.savings_days) + extraDays,                              // factor 2.4
        cashflow_volatility: round2(Math.max(0, num(p.cashflow_volatility) - 0.05)), // factor 2.3
      };
    },
  },
  // "What if I set up auto-pay for rent and utility bills?"
  autopay: {
    label: 'Set up auto-pay for rent and bills',
    apply: (p) => ({
      // Math.max: never make a value WORSE than it already is
      on_time_rate: Math.max(num(p.on_time_rate), 0.98),                 // factor 3.1
      digital_payment_rate: Math.max(num(p.digital_payment_rate), 0.95), // factor 1.3
      // Only renters get the rent boost (factor 1.2); the spread adds nothing for others
      ...(p.housing === 'rent' && { rent_on_time_months: Math.max(num(p.rent_on_time_months), 12) }),
    }),
  },
  // "What if I spend 75% of income on non-essentials for 2 months?"
  overspend: {
    label: 'Overspend on lifestyle for 2 months',
    apply: (p) => ({
      monthly_spend: round2(num(p.monthly_income) * 0.9),                      // factor 2.1
      essential_pct: 0.25,                                                     // factor 2.2
      cashflow_volatility: round2(Math.max(num(p.cashflow_volatility), 0.25)), // factor 2.3
    }),
  },
  // "What if I miss bills by 45 days and delay rent by 15 days?"
  missed_bills: {
    label: 'Miss bill payments by 45 days',
    apply: (p) => ({
      delinq_30plus: num(p.delinq_30plus) + 1,                                        // factor 3.4
      on_time_rate: round2(clamp(num(p.on_time_rate) - 0.15, 0, 1)),                 // factor 3.1
      digital_payment_rate: round2(clamp(num(p.digital_payment_rate) - 0.2, 0, 1)),  // factor 1.3
    }),
  },
};

// Checks the user's custom "changes" against the whitelist.
// Collects ALL problems first, then throws once -> the user sees every mistake at the same time.
function validateChanges(changes) {
  if (changes === undefined) return {}; // no custom changes is fine (scenario only)
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) {
    throw new AppError(400, 'INVALID_CHANGES', '"changes" must be an object like { "savings_days": 200 }');
  }
  const errors = [];
  const clean = {};
  for (const [field, raw] of Object.entries(changes)) {
    const rule = EDITABLE[field];
    if (!rule) { errors.push({ field, reason: 'cannot be changed in the simulator' }); continue; }

    // Text fields: must be one of the allowed values
    if (rule.oneOf) {
      if (!rule.oneOf.includes(raw)) errors.push({ field, reason: `must be one of ${rule.oneOf.join(', ')}` });
      else clean[field] = raw;
      continue;
    }

    // Number fields: must be numeric, in range, and whole if required
    const v = Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(v)) errors.push({ field, reason: 'must be a number' });
    else if (v < rule.min || v > rule.max) errors.push({ field, reason: `must be between ${rule.min} and ${rule.max}` });
    else if (rule.integer && !Number.isInteger(v)) errors.push({ field, reason: 'must be a whole number' });
    else clean[field] = v;
  }
  if (errors.length) throw new AppError(400, 'INVALID_CHANGES', 'Some changes are not allowed', errors);
  return clean;
}

// Compares two engine results and returns only the factors whose points changed
// e.g. { label: 'On-time payment rate', from: 0, to: 200, change: +200 }
function diffFactors(before, after) {
  const beforeByKey = Object.fromEntries(before.breakdown.map((f) => [f.key, f]));
  return after.breakdown
    .filter((f) => f.points !== beforeByKey[f.key].points)
    .map((f) => ({
      key: f.key, label: f.label,
      from: beforeByKey[f.key].points, to: f.points, change: f.points - beforeByKey[f.key].points,
      reason: f.reason,
    }));
}

// POST /users/:id/what-if
async function simulate(userId, { scenario, params, changes } = {}, actor) {
  // 1. Validate input before touching the database
  if (scenario && !SCENARIOS[scenario]) {
    throw new AppError(400, 'UNKNOWN_SCENARIO', `Scenario must be one of ${Object.keys(SCENARIOS).join(', ')}`);
  }
  const custom = validateChanges(changes);
  if (!scenario && Object.keys(custom).length === 0) {
    throw new AppError(400, 'NOTHING_TO_SIMULATE', 'Send a "scenario" and/or "changes"');
  }

  // 2. Build the "what if" profile: current data + scenario changes + custom changes
  const profile = await getScoringProfile(userId);
  const fromScenario = scenario ? SCENARIOS[scenario].apply(profile, params) : {};
  const applied = { ...fromScenario, ...custom };       // custom values win over scenario values
  const simulatedProfile = { ...profile, ...applied };  // a COPY: the real profile is untouched, nothing saved

  // 3. Score both with the SAME engine, so the simulation is always consistent with real scores
  const before = scoreProfile(profile);
  const after = scoreProfile(simulatedProfile);
  const [productsBefore, productsAfter] = await Promise.all([
    productsForScore(before.score), productsForScore(after.score),
  ]);

  // 4. Work out which products are gained or lost (Set = fast "is this id in the list?")
  const beforeIds = new Set(productsBefore.eligible.map((p) => p.product_id));
  const afterIds = new Set(productsAfter.eligible.map((p) => p.product_id));

  // 5. Audit it: also useful later for ML Case 2 ("users who play with the simulator = high intent")
  await logAudit({ actor, action: 'WHAT_IF_RUN', entity: 'user', entityId: userId,
    details: { scenario: scenario || null, changes: applied, from: before.score, to: after.score } });

  return {
    user_id: userId,
    scenario: scenario ? { key: scenario, label: SCENARIOS[scenario].label } : null,
    applied_changes: applied,
    current: { score: before.score, risk_band: before.risk_band },
    simulated: { score: after.score, risk_band: after.risk_band, color: after.color },
    difference: after.score - before.score,
    changed_factors: diffFactors(before, after),
    newly_unlocked: productsAfter.eligible.filter((p) => !beforeIds.has(p.product_id)),
    would_lose: productsBefore.eligible.filter((p) => !afterIds.has(p.product_id)),
    note: 'Simulation only. Nothing was saved.',
  };
}

module.exports = { simulate, validateChanges, SCENARIOS, EDITABLE };