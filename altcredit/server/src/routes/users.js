const express = require('express');
const { assertUserId, parsePagination } = require('../utils/validation');
const { getCurrentScore, getScoreHistory } = require('../services/scoreService');
const { productsForScore } = require('../services/productService');
const { listTransactions } = require('../services/transactionService');
const { simulate, SCENARIOS } = require('../services/whatIfService');

// Routes are THIN: read the request -> call a service -> send JSON.
// All real logic lives in services/, so it can be tested without HTTP.
const router = express.Router();

// Who is making the request (written to the audit log).
// TODO step 5: requireAuth + "users can only see their own data", actor from the token
const actorOf = (req) => (req.user ? req.user.username : 'anonymous');

// router.param runs automatically for every route that has :id in it.
// One place to validate the id instead of repeating the check in each route.
router.param('id', (req, res, next, id) => {
  assertUserId(id); // throws AppError 400 if not like USR_001
  next();
});

// GET /users/USR_001/score -> score, band, breakdown, top factors, eligible/locked products
router.get('/:id/score', async (req, res) => {
  // Express 5: if this await throws, the error goes straight to errorHandler (no try/catch needed)
  res.json(await getCurrentScore(req.params.id, actorOf(req)));
});

// GET /users/USR_001/score/history -> how the score changed over time
router.get('/:id/score/history', async (req, res) => {
  res.json({ user_id: req.params.id, history: await getScoreHistory(req.params.id) });
});

// GET /users/USR_001/products -> what this user can apply for, and what is still locked
router.get('/:id/products', async (req, res) => {
  const { score, risk_band } = await getCurrentScore(req.params.id, actorOf(req));
  res.json({ user_id: req.params.id, score, risk_band, ...(await productsForScore(score)) });
});

// GET /users/USR_001/transactions?month=2023-06&category=Rent&status=Late&page=1&limit=20
// All query params are optional. parsePagination gives safe page/limit defaults.
router.get('/:id/transactions', async (req, res) => {
  res.json(await listTransactions(req.params.id, req.query, parsePagination(req.query)));
});

// GET /users/what-if/scenarios -> list of presets, so the UI can draw a button for each
router.get('/what-if/scenarios', (req, res) => {
  res.json(Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label })));
});

// POST /users/USR_001/what-if
// body: { "scenario": "autopay" }  or  { "changes": { "savings_days": 200 } }  or both
router.post('/:id/what-if', async (req, res) => {
  const { scenario, params, changes } = req.body || {}; // `|| {}` so an empty body does not crash
  res.json(await simulate(req.params.id, { scenario, params, changes }, actorOf(req)));
});

module.exports = router;