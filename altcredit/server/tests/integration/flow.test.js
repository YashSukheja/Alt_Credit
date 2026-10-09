// End-to-end API test: real Express app + real PostgreSQL (test DB) + real mock bank.
// Follows the same story as the demo: login -> score -> what-if -> lender offer -> accept -> report.
const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const { pool } = require('../../src/config/db');
const { anonRef } = require('../../src/utils/anonymise');
const { createBankApp } = require('../../../bank-mock/src/app');

let bankServer;
let bankApp;
const tokens = {};
const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

// Start the mock bank on a random free port and point AltCredit at it
beforeAll(async () => {
  config.bankApiKey = config.bankApiKey || 'test-bank-key';
  bankApp = createBankApp({ apiKey: config.bankApiKey });
  await new Promise((resolve) => { bankServer = bankApp.listen(0, resolve); });
  config.bankApiUrl = `http://127.0.0.1:${bankServer.address().port}`;
  config.bankTimeoutMs = 2000;

  // Log in once per role and keep the tokens
  const logins = { admin: 'SEED_ADMIN_PASSWORD', lender1: 'SEED_LENDER_PASSWORD', usr001: 'SEED_USER_PASSWORD', usr002: 'SEED_USER_PASSWORD' };
  for (const [username, envKey] of Object.entries(logins)) {
    const res = await request(app).post('/auth/login').send({ username, password: process.env[envKey] });
    expect(res.status).toBe(200);
    tokens[username] = res.body.token;
  }
});

afterAll(async () => {
  await new Promise((resolve) => bankServer.close(resolve));
  await pool.end();
});

const setBankMode = (mode) => request(bankApp).post('/bank/simulate').set('x-api-key', config.bankApiKey).send({ mode });

describe('basics', () => {
  test('health is ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('up');
  });

  test('wrong password and unknown user give the same 401', async () => {
    const a = await request(app).post('/auth/login').send({ username: 'usr001', password: 'nope' });
    const b = await request(app).post('/auth/login').send({ username: 'ghost', password: 'nope' });
    expect(a.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  test('unknown route is a JSON 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  test('CORS allows the configured frontend origin', async () => {
    const res = await request(app).get('/health').set('Origin', config.clientOrigins[0]);
    expect(res.headers['access-control-allow-origin']).toBe(config.clientOrigins[0]);
  });
});

describe('access control', () => {
  test('no token -> 401', async () => {
    expect((await request(app).get('/users/USR_001/score')).status).toBe(401);
  });
  test("another user's data -> 403", async () => {
    expect((await request(app).get('/users/USR_001/score').set(auth('usr002'))).status).toBe(403);
  });
  test('lender cannot use user routes, user cannot use lender or admin routes', async () => {
    expect((await request(app).get('/users/USR_001/score').set(auth('lender1'))).status).toBe(403);
    expect((await request(app).get('/lender/candidates').set(auth('usr001'))).status).toBe(403);
    expect((await request(app).get('/admin/audit').set(auth('usr001'))).status).toBe(403);
  });
});

describe('scoring', () => {
  test('USR_001 scores 635 with breakdown and products', async () => {
    const res = await request(app).get('/users/USR_001/score').set(auth('usr001'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 635, risk_band: 'Medium Risk' });
    expect(res.body.breakdown).toHaveLength(14);
    expect(res.body.products.eligible.map((p) => p.product_id)).toEqual(['P_01', 'P_02']);
  });

  test('what-if autopay gives 885 and saves nothing', async () => {
    const before = await request(app).get('/users/USR_001/score/history').set(auth('usr001'));
    const res = await request(app).post('/users/USR_001/what-if').set(auth('usr001')).send({ scenario: 'autopay' });
    expect(res.status).toBe(200);
    expect(res.body.simulated.score).toBe(885);
    const after = await request(app).get('/users/USR_001/score/history').set(auth('usr001'));
    expect(after.body.history).toHaveLength(before.body.history.length);
  });

  test('invalid what-if input is rejected with reasons', async () => {
    const res = await request(app).post('/users/USR_001/what-if').set(auth('usr001'))
      .send({ changes: { on_time_rate: 5, user_id: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(2);
  });
});

describe('lender -> offer -> accept -> bank', () => {
  const ref = () => anonRef('USR_001');
  const sendOffer = (productId) => request(app).post('/lender/offers').set(auth('lender1'))
    .send({ product_id: productId, refs: [ref()] });

  test('candidate search is anonymised', async () => {
    const res = await request(app).get('/lender/candidates?minScore=650&limit=50').set(auth('lender1'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/USR_\d+/);
  });

  test('offer above the score is skipped, qualifying offer is sent once', async () => {
    const tooHigh = await sendOffer('P_03');
    expect(tooHigh.body.skipped[0].reason).toMatch(/below 650/);
    const ok = await sendOffer('P_02');
    expect(ok.body.sent_count).toBe(1);
    const again = await sendOffer('P_02');
    expect(again.body.skipped[0].reason).toBe('already offered');
  });

  test('accept calls the bank, and the lender can now see who it is', async () => {
    const offers = await request(app).get('/users/USR_001/offers').set(auth('usr001'));
    const offer = offers.body.find((o) => o.product_id === 'P_02');
    const res = await request(app).post(`/users/USR_001/offers/${offer.offer_id}/accept`).set(auth('usr001'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', bank: { status: 'APPROVED' } });

    const lenderView = await request(app).get('/lender/offers').set(auth('lender1'));
    expect(lenderView.body.find((o) => o.offer_id === offer.offer_id).user_id).toBe('USR_001');
  });

  test('two accepts at the same time: exactly one wins', async () => {
    const { body } = await sendOffer('P_01');
    const id = body.sent[0].offer_id;
    const url = `/users/USR_001/offers/${id}/accept`;
    const results = await Promise.all([
      request(app).post(url).set(auth('usr001')),
      request(app).post(url).set(auth('usr001')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  test('bank down: 503 and the offer stays pending, then succeeds later', async () => {
    await pool.query("DELETE FROM offers WHERE user_id = 'USR_001' AND product_id = 'P_01'");
    const { body } = await sendOffer('P_01');
    const id = body.sent[0].offer_id;

    await setBankMode('down');
    const failed = await request(app).post(`/users/USR_001/offers/${id}/accept`).set(auth('usr001'));
    expect(failed.status).toBe(503);
    const status = (await pool.query('SELECT status FROM offers WHERE offer_id = $1', [id])).rows[0].status;
    expect(status).toBe('pending');

    await setBankMode('normal');
    const retried = await request(app).post(`/users/USR_001/offers/${id}/accept`).set(auth('usr001'));
    expect(retried.body.status).toBe('accepted');
  });
});

describe('reports and audit', () => {
  test('PDF report downloads', async () => {
    const res = await request(app).get('/users/USR_001/report.pdf').set(auth('usr001'))
      .buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('audit log recorded the important actions', async () => {
    const res = await request(app).get('/admin/audit?limit=200').set(auth('admin'));
    const actions = new Set(res.body.results.map((r) => r.action));
    ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'REPORT_GENERATED', 'WHAT_IF_RUN']
      .forEach((a) => expect(actions).toContain(a));
  });
});