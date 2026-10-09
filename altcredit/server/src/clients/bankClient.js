const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const config = require('../config/env');

// Talks to the partner bank over HTTP. Three protections:
//  1. timeout  - never wait forever for a slow bank
//  2. retry    - one more try for temporary failures (network blip, 5xx)
//  3. idempotency key - so a retry can never open two accounts

// fetch with a time limit. AbortController cancels the request when the timer fires.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer); // always clean up the timer
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retrying is safe ONLY because the bank de-duplicates by Idempotency-Key
async function submitApplication(payload, { idempotencyKey, opts = {} } = {}) {
  const { baseUrl = config.bankApiUrl, apiKey = config.bankApiKey,
    timeoutMs = config.bankTimeoutMs, retries = 1, retryDelayMs = 300 } = opts;
  if (!apiKey) throw new AppError(500, 'BANK_NOT_CONFIGURED', 'BANK_API_KEY is not set');

  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/bank/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      }, timeoutMs);
      const body = await res.json().catch(() => ({}));

      // 2xx: bank gave an answer (APPROVED or DECLINED)
      if (res.ok) return body;

      // 4xx: OUR request is wrong (bad key, bad data). Retrying will not help.
      if (res.status < 500) {
        logger.error('Bank rejected request', { status: res.status, body });
        throw new AppError(502, 'BANK_REQUEST_REJECTED', `Bank refused the request (${res.status})`, body.error);
      }

      // 5xx: bank problem, worth one retry
      lastError = new AppError(503, 'BANK_UNAVAILABLE', 'Bank is temporarily unavailable, please try again');
    } catch (err) {
      if (err instanceof AppError && err.code === 'BANK_REQUEST_REJECTED') throw err; // do not retry 4xx
      lastError = err.name === 'AbortError'
        ? new AppError(504, 'BANK_TIMEOUT', `Bank did not answer within ${timeoutMs} ms`)
        : (err instanceof AppError ? err : new AppError(503, 'BANK_UNAVAILABLE', 'Cannot reach the bank, please try again'));
    }
    logger.warn('Bank call failed', { attempt, code: lastError.code });
    if (attempt <= retries) await sleep(retryDelayMs * attempt); // wait a little longer each time
  }
  throw lastError;
}

module.exports = { submitApplication };