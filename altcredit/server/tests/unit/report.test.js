const { PassThrough } = require('stream');
const { renderTransparencyPdf } = require('../../src/reports/transparencyPdf');
const { decisionFor } = require('../../src/services/reportService');
const { scoreProfile } = require('../../src/engine/scorer');
const { splitByScore } = require('../../src/services/productService');

const PRODUCTS = [
  { product_id: 'P_01', product_name: 'Starter Credit Card', type: 'Credit Card', min_score: 350, interest_rate: 12, rate_unit: 'APR' },
  { product_id: 'P_02', product_name: 'Micro-Loan Lite', type: 'Loan', min_score: 550, interest_rate: 17, rate_unit: 'PA' },
];

// Build a report-data object without the database
function sampleData(profile) {
  const r = scoreProfile(profile);
  const products = splitByScore(PRODUCTS, r.score);
  return {
    report_id: 'RPT-TEST', generated_at: new Date().toISOString(),
    applicant: { user_id: 'USR_TEST', age: 23, employment_status: 'Employed', education_level: "Master's", city_tier: 1, monthly_income: 1540 },
    ...r, decision: decisionFor(r.score, products), products, disclaimer: 'Test only.',
  };
}

// Render into memory and return the bytes
function renderToBuffer(data) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    renderTransparencyPdf(data, stream);
  });
}

describe('transparency report', () => {
  test('decision is APPROVED when at least one product is unlocked', () => {
    expect(decisionFor(400, splitByScore(PRODUCTS, 400)).outcome).toBe('APPROVED');
    expect(decisionFor(200, splitByScore(PRODUCTS, 200))).toEqual({
      outcome: 'NOT APPROVED', summary: expect.stringMatching(/150 points below/),
    });
  });

  test('renders a valid PDF for a normal profile', async () => {
    const buf = await renderToBuffer(sampleData({
      months_at_job: 35, housing: 'none', digital_payment_rate: 0.62, education: 'master', monthly_income: 1540,
      monthly_spend: 477, essential_pct: 0.47, cashflow_volatility: 0.2, savings_days: 180, on_time_rate: 0.61,
      dti: 0.52, credit_util: 0.23, delinq_30plus: 0, delinq_60plus: 0, delinq_90plus: 0, positive_habits: 0, risk_flags: 0,
    }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-'); // every PDF file starts with these bytes
    expect(buf.length).toBeGreaterThan(2000);
  });

  test('renders even when most data is missing (robustness)', async () => {
    const buf = await renderToBuffer(sampleData({ monthly_income: 1000 }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});