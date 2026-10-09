const crypto = require('crypto');
const express = require('express');

// A tiny pretend bank. It has its OWN rules and its OWN memory (no shared database):
// this is what "two separate applications linked by an API key" means.

// The bank's lending policy per product. It re-checks the score itself
// instead of blindly trusting AltCredit (defence in depth).
const POLICY = {
  P_01: { min_score: 350, kind: 'card', limit: 25000 },
  P_02: { min_score: 550, kind: 'loan', limit: 50000 },
  P_03: { min_score: 650, kind: 'card', limit: 100000 },
  P_04: { min_score: 750, kind: 'loan', limit: 300000 },
};

function createBankApp({ apiKey }) {
  if (!apiKey) throw new Error('BANK_API_KEY is required');
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // In-memory storage (resets on restart, fine for a mock)
  const applications = new Map();   // application_id -> application
  const byIdempotencyKey = new Map(); // Idempotency-Key -> { bodyHash, application_id }

  // Demo switch to show what happens when the bank is down or slow
  let mode = 'normal'; // 'normal' | 'down' | 'slow'

  // ---------- 1. API key check ----------
  // timingSafeEqual compares in constant time, so the key cannot be guessed
  // character by character by measuring response times.
  const keyBuf = Buffer.from(apiKey);
  function requireApiKey(req, res, next) {
    const given = Buffer.from(req.get('x-api-key') || '');
    const ok = given.length === keyBuf.length && crypto.timingSafeEqual(given, keyBuf);
    if (!ok) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing or wrong x-api-key' } });
    return next();
  }

  // ---------- 2. Simulated outage / slowness (for the resilience demo) ----------
  async function simulate(req, res, next) {
    if (mode === 'down') return res.status(503).json({ error: { code: 'BANK_DOWN', message: 'Bank is temporarily unavailable' } });
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 8000)); // longer than AltCredit's timeout
    return next();
  }

  app.get('/health', (req, res) => res.json({ status: 'ok', mode, applications: applications.size }));

  // POST /bank/simulate { "mode": "down" } -> switch failure mode (protected by the same key)
  app.post('/bank/simulate', requireApiKey, (req, res) => {
    const next = req.body && req.body.mode;
    if (!['normal', 'down', 'slow'].includes(next)) {
      return res.status(400).json({ error: { code: 'INVALID_MODE', message: 'mode must be normal, down or slow' } });
    }
    mode = next;
    return res.json({ mode });
  });

  // ---------- 3. Open an account / loan ----------
  // POST /bank/applications   headers: x-api-key, Idempotency-Key
  // body: { user_ref, product_id, score, offer_id }
  app.post('/bank/applications', requireApiKey, simulate, (req, res) => {
    const { user_ref: userRef, product_id: productId, score, offer_id: offerId } = req.body || {};
    const idemKey = req.get('idempotency-key');

    // Validate input
    const errors = [];
    if (!idemKey) errors.push('Idempotency-Key header is required');
    if (typeof userRef !== 'string' || !userRef) errors.push('user_ref is required');
    if (!POLICY[productId]) errors.push(`unknown product_id ${productId}`);
    if (!Number.isInteger(score) || score < 0 || score > 1000) errors.push('score must be an integer 0-1000');
    if (errors.length) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: errors.join('; ') } });

    // Idempotency: the same key always gets the same answer.
    // If AltCredit retries after a timeout, the customer is NOT given two credit cards.
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify({ userRef, productId, score, offerId })).digest('hex');
    const seen = byIdempotencyKey.get(idemKey);
    if (seen) {
      if (seen.bodyHash !== bodyHash) {
        return res.status(422).json({ error: { code: 'IDEMPOTENCY_MISMATCH', message: 'Same Idempotency-Key used with a different request' } });
      }
      return res.status(200).json({ ...applications.get(seen.application_id), replayed: true });
    }

    // The bank's own decision
    const policy = POLICY[productId];
    const approved = score >= policy.min_score;
    const application = {
      application_id: `BNK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      offer_id: offerId ?? null,
      user_ref: userRef,
      product_id: productId,
      status: approved ? 'APPROVED' : 'DECLINED',
      reason: approved ? null : `Bank policy needs score ${policy.min_score}, got ${score}`,
      ...(approved && (policy.kind === 'card' ? { credit_limit: policy.limit } : { loan_amount: policy.limit })),
      created_at: new Date().toISOString(),
    };
    applications.set(application.application_id, application);
    byIdempotencyKey.set(idemKey, { bodyHash, application_id: application.application_id });

    return res.status(201).json(application);
  });

  // GET /bank/applications/BNK-1234ABCD -> look up an application
  app.get('/bank/applications/:id', requireApiKey, (req, res) => {
    const a = applications.get(req.params.id);
    if (!a) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `No application ${req.params.id}` } });
    return res.json(a);
  });

  // Unknown route + last-resort error handler: always JSON, never a crash
  app.use((req, res) => res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `No route ${req.method} ${req.originalUrl}` } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: { code: status === 400 ? 'INVALID_JSON' : 'BANK_ERROR', message: err.message } });
  });

  return app;
}

module.exports = { createBankApp, POLICY };