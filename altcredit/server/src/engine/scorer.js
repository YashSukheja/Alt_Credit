// scoreProfile(profile) -> score, band, breakdown with reasons and tips.
// profile = user_features row + monthly_income from users.
// Pure function: same input always gives the same output.

const { FACTORS, ADJUSTMENTS, RISK_BANDS, MAX_SCORE, RULE_VERSION } = require('./rules');

// pg returns NUMERIC columns as strings ("0.620"), so convert once here
const NUMERIC_FIELDS = ['months_at_job', 'rent_on_time_months', 'digital_payment_rate', 'monthly_spend',
  'monthly_income', 'essential_pct', 'cashflow_volatility', 'savings_days', 'on_time_rate', 'dti',
  'credit_util', 'delinq_30plus', 'delinq_60plus', 'delinq_90plus', 'positive_habits', 'risk_flags'];

function normalise(profile) {
  const p = { ...profile };
  for (const f of NUMERIC_FIELDS) {
    if (p[f] === undefined || p[f] === null || p[f] === '') p[f] = null;
    else p[f] = Number(p[f]);
    if (Number.isNaN(p[f])) p[f] = null;
  }
  return p;
}

function riskBandFor(score) {
  return RISK_BANDS.find((b) => score >= b.min);
}

function scoreFactor(factor, p) {
  const value = factor.value(p);
  const base = { key: factor.key, code: factor.code, component: factor.component, label: factor.label, max: factor.max };

  // Missing data: no crash, zero points, clearly flagged
  if (value === null || value === undefined) {
    return { ...base, value: null, points: 0, missing: true,
      reason: 'No data available, scored 0', tip: `Share ${factor.label.toLowerCase()} data to earn up to ${factor.max} points` };
  }

  const idx = factor.bands.findIndex((b) => b.test(value));
  const band = factor.bands[idx];
  const better = idx > 0 ? factor.bands[idx - 1] : null; // next band up
  return {
    ...base,
    value,
    points: band.points,
    missing: false,
    reason: `${factor.format(value)}: ${band.points}/${factor.max} points`,
    tip: better ? `Reach ${better.need} for +${better.points - band.points} points` : null,
  };
}

function scoreAdjustment(adj, p) {
  const value = adj.value(p);
  const points = adj.points(value);
  return {
    key: adj.key, code: adj.code, component: adj.component, label: adj.label,
    max: adj.max, min: adj.min ?? 0, value, points, missing: false,
    reason: `${adj.format(value)}: ${points >= 0 ? '+' : ''}${points} points`,
    tip: null,
  };
}

function scoreProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('scoreProfile needs a profile object');
  const p = normalise(profile);

  const breakdown = [
    ...FACTORS.map((f) => scoreFactor(f, p)),
    ...ADJUSTMENTS.map((a) => scoreAdjustment(a, p)),
  ];

  const rawPoints = breakdown.reduce((sum, f) => sum + f.points, 0);
  // Rule table adds up to 1320; problem statement scale is 0-1000, so cap it
  const score = Math.max(0, Math.min(MAX_SCORE, rawPoints));
  const { band, color } = riskBandFor(score);

  const components = {};
  for (const f of breakdown) {
    components[f.component] = components[f.component] || { points: 0, max: 0 };
    components[f.component].points += f.points;
    components[f.component].max += f.max;
  }

  // Strongest and weakest factors, for the explainability panel
  const scored = breakdown.filter((f) => f.max > 0);
  const byShare = [...scored].sort((a, b) => b.points / b.max - a.points / a.max || b.points - a.points);
  const topPositive = byShare.filter((f) => f.points > 0).slice(0, 3)
    .map((f) => ({ key: f.key, label: f.label, points: f.points, max: f.max, reason: f.reason }));
  const byLost = [...scored].sort((a, b) => (b.max - b.points) - (a.max - a.points));
  const topNegative = byLost.filter((f) => f.points < f.max).slice(0, 3)
    .map((f) => ({ key: f.key, label: f.label, points: f.points, max: f.max, lost: f.max - f.points, reason: f.reason, tip: f.tip }));
  const penalties = breakdown.filter((f) => f.points < 0)
    .map((f) => ({ key: f.key, label: f.label, points: f.points, reason: f.reason }));

  return {
    score,
    raw_points: rawPoints,
    risk_band: band,
    color,
    rule_version: RULE_VERSION,
    components,
    breakdown,
    top_positive: topPositive,
    top_negative: [...topNegative, ...penalties],
    missing_data: breakdown.filter((f) => f.missing).map((f) => f.key),
  };
}

module.exports = { scoreProfile, riskBandFor, normalise };