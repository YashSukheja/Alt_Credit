const express = require('express');
const { submitApplication } = require('../../src/clients/bankClient');

// A fake bank we fully control, started on a random free port for each test.
// `behaviour` decides how the next calls are answered.
function startFakeBank(behaviour) {
  const app = express();
  app.use(express.json());
  const calls = [];
  app.post('/bank/applications', async (req, res) => {
    calls.push({ key: req.get('idempotency-key'), apiKey: req.get('x-api-key') });
    const step = behaviour[Math.min(calls.length - 1, behaviour.length - 1)];
    if (step === 'slow') await new Promise((r) => setTimeout(r, 500));
    if (step === 'down') return res.status(503).json({ error: { code: 'BANK_DOWN' } });
    if (step === 'badkey') return res.status(401).json({ error: { code: 'INVALID_API_KEY' } });
    return res.status(201).json({ application_id: 'BNK-TEST', status: 'APPROVED' });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const call = (url, extra = {}) => submitApplication(
  { user_ref: 'C-1', product_id: 'P_01', score: 600 },
  { idempotencyKey: 'altcredit-offer-1', opts: { baseUrl: url, apiKey: 'k', retryDelayMs: 10, ...extra } },
);

describe('bankClient', () => {
  let bank;
  afterEach(() => bank && bank.server.close());

  test('sends API key and Idempotency-Key, returns the bank answer', async () => {
    bank = await startFakeBank(['ok']);
    await expect(call(bank.url)).resolves.toMatchObject({ status: 'APPROVED' });
    expect(bank.calls[0]).toEqual({ key: 'altcredit-offer-1', apiKey: 'k' });
  });

  test('retries once after a 5xx and succeeds, using the SAME idempotency key', async () => {
    bank = await startFakeBank(['down', 'ok']);
    await expect(call(bank.url)).resolves.toMatchObject({ status: 'APPROVED' });
    expect(bank.calls).toHaveLength(2);
    expect(bank.calls[0].key).toBe(bank.calls[1].key);
  });

  test('gives up after retries with BANK_UNAVAILABLE', async () => {
    bank = await startFakeBank(['down']);
    await expect(call(bank.url)).rejects.toMatchObject({ statusCode: 503, code: 'BANK_UNAVAILABLE' });
    expect(bank.calls).toHaveLength(2); // 1 try + 1 retry
  });

  test('does NOT retry a 4xx (our request is wrong)', async () => {
    bank = await startFakeBank(['badkey']);
    await expect(call(bank.url)).rejects.toMatchObject({ code: 'BANK_REQUEST_REJECTED' });
    expect(bank.calls).toHaveLength(1);
  });

  test('times out a slow bank with BANK_TIMEOUT', async () => {
    bank = await startFakeBank(['slow']);
    await expect(call(bank.url, { timeoutMs: 100, retries: 0 })).rejects.toMatchObject({ statusCode: 504, code: 'BANK_TIMEOUT' });
  });

  test('bank not running at all -> BANK_UNAVAILABLE, no crash', async () => {
    bank = null;
    await expect(call('http://127.0.0.1:1')).rejects.toMatchObject({ code: 'BANK_UNAVAILABLE' });
  });
});