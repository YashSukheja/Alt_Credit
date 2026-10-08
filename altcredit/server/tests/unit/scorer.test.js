const { scoreProfile, riskBandFor } = require('../../src/engine/scorer');

// A strong profile that hits the top band everywhere
const perfect = {
  months_at_job: 36, housing: 'owner', rent_on_time_months: 0, digital_payment_rate: 1,
  education: 'phd', monthly_income: 10000, monthly_spend: 2000, essential_pct: 0.8,
  cashflow_volatility: 0.03, savings_days: 200, on_time_rate: 1, dti: 0.1, credit_util: 0.05,
  delinq_30plus: 0, delinq_60plus: 0, delinq_90plus: 0, positive_habits: 3, risk_flags: 0,
};

const factor = (result, key) => result.breakdown.find((f) => f.key === key);
const withChange = (changes) => scoreProfile({ ...perfect, ...changes });

describe('scoreProfile: totals', () => {
  test('perfect profile is capped at 1000 even though raw points are higher', () => {
    const r = scoreProfile(perfect);
    expect(r.raw_points).toBe(1320); // 1270 from factors + 50 habit bonus
    expect(r.score).toBe(1000);
    expect(r.risk_band).toBe('Very Low Risk');
  });

  test('real dataset user USR_001 scores 635 (Medium Risk)', () => {
    const usr001 = {
      months_at_job: 35, housing: 'none', rent_on_time_months: 0, digital_payment_rate: 0.62,
      education: 'master', monthly_income: 1540, monthly_spend: 477, essential_pct: 0.47,
      cashflow_volatility: 0.2, savings_days: 180, on_time_rate: 0.61, dti: 0.52, credit_util: 0.23,
      delinq_30plus: 0, delinq_60plus: 0, delinq_90plus: 0, positive_habits: 0, risk_flags: 0,
    };
    const r = scoreProfile(usr001);
    expect(r.score).toBe(635);
    expect(r.risk_band).toBe('Medium Risk');
  });

  test('score never goes below 0', () => {
    const r = scoreProfile({ monthly_income: 1000, risk_flags: 3 });
    expect(r.score).toBe(0);
    expect(r.raw_points).toBeLessThan(0);
  });
});

describe('scoreProfile: band boundaries', () => {
  test.each([
    [24, 150], [23, 100], [12, 100], [11, 50], [6, 50], [5, 0],
  ])('employment: %i months -> %i points', (months, pts) => {
    expect(factor(withChange({ months_at_job: months }), 'employment_stability').points).toBe(pts);
  });

  test.each([
    [0.98, 200], [0.97, 150], [0.95, 150], [0.94, 100], [0.90, 100], [0.89, 50], [0.80, 50], [0.79, 0],
  ])('on-time rate %f -> %i points', (rate, pts) => {
    expect(factor(withChange({ on_time_rate: rate }), 'on_time_payments').points).toBe(pts);
  });

  test.each([
    ['owner', 0, 80], ['rent', 12, 60], ['rent', 11, 30], ['none', 0, 0],
  ])('housing %s with %i on-time months -> %i points', (housing, months, pts) => {
    expect(factor(withChange({ housing, rent_on_time_months: months }), 'housing_status').points).toBe(pts);
  });

  test('spend-to-income uses income from the profile', () => {
    expect(factor(withChange({ monthly_spend: 3000 }), 'spend_to_income').points).toBe(120); // 30%
    expect(factor(withChange({ monthly_spend: 3001 }), 'spend_to_income').points).toBe(80);
    expect(factor(withChange({ monthly_spend: 7500 }), 'spend_to_income').points).toBe(0);
  });

  test.each([
    [{ delinq_30plus: 0, delinq_60plus: 0, delinq_90plus: 0 }, 150],
    [{ delinq_30plus: 1, delinq_60plus: 0, delinq_90plus: 0 }, 100],
    [{ delinq_30plus: 0, delinq_60plus: 1, delinq_90plus: 0 }, 50],
    [{ delinq_30plus: 0, delinq_60plus: 0, delinq_90plus: 1 }, 0],
    [{ delinq_30plus: 2, delinq_60plus: 0, delinq_90plus: 0 }, 0],
  ])('delinquency %o -> %i points', (d, pts) => {
    expect(factor(withChange(d), 'delinquency').points).toBe(pts);
  });

  test('habits capped at +50, flags capped at -50', () => {
    expect(factor(withChange({ positive_habits: 3 }), 'positive_habits').points).toBe(50);
    expect(factor(withChange({ positive_habits: 2 }), 'positive_habits').points).toBe(40);
    expect(factor(withChange({ risk_flags: 2 }), 'risk_flags').points).toBe(-40);
    expect(factor(withChange({ risk_flags: 3 }), 'risk_flags').points).toBe(-50);
  });
});

describe('scoreProfile: robustness and explanations', () => {
  test('missing delinquency data earns 0, not the "no missed payments" 150', () => {
    const r = scoreProfile({ monthly_income: 1000 });
    expect(factor(r, 'delinquency')).toMatchObject({ points: 0, missing: true });
  });

  test('missing data scores 0 for that factor without crashing', () => {
    const { savings_days, on_time_rate, ...partial } = perfect;
    const r = scoreProfile(partial);
    expect(factor(r, 'savings_buffer')).toMatchObject({ points: 0, missing: true });
    expect(r.missing_data).toEqual(expect.arrayContaining(['savings_buffer', 'on_time_payments']));
  });

  test('numeric strings from PostgreSQL are handled', () => {
    const r = scoreProfile({ ...perfect, on_time_rate: '0.980', monthly_income: '10000.00' });
    expect(factor(r, 'on_time_payments').points).toBe(200);
  });

  test('every factor has a reason, and a tip unless already at max', () => {
    const r = withChange({ on_time_rate: 0.85 });
    const f = factor(r, 'on_time_payments');
    expect(f.reason).toMatch(/85%/);
    expect(f.tip).toMatch(/\+50 points/);
    expect(factor(r, 'employment_stability').tip).toBeNull();
  });

  test('top_negative lists the factor that lost the most points first', () => {
    const r = withChange({ on_time_rate: 0.5 });
    expect(r.top_negative[0].key).toBe('on_time_payments');
  });

  test('risk band thresholds match product catalogue', () => {
    expect(riskBandFor(750).band).toBe('Very Low Risk');
    expect(riskBandFor(749).band).toBe('Low Risk');
    expect(riskBandFor(550).band).toBe('Medium Risk');
    expect(riskBandFor(349).band).toBe('Very High Risk');
  });
});