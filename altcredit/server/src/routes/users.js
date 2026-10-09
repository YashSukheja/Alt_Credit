const express = require('express');
const { assertUserId, parsePagination } = require('../utils/validation');
const { requireAuth, requireRole, assertCanAccessUser } = require('../middleware/auth');
const { getCurrentScore, getScoreHistory } = require('../services/scoreService');
const { productsForScore } = require('../services/productService');
const { listTransactions } = require('../services/transactionService');
const { simulate, SCENARIOS } = require('../services/whatIfService');
const { listUserOffers, rejectOffer, acceptOffer } = require('../services/offerService');
const { buildReportData } = require('../services/reportService');        
const { renderTransparencyPdf } = require('../reports/transparencyPdf'); 

// Routes are THIN: read the request -> call a service -> send JSON.
const router = express.Router();

// Every route below needs a valid login token
router.use(requireAuth);

// Who is making the request (written to the audit log)
const actorOf = (req) => req.user.username;

// Runs for every route with :id ->
//  1. is the id well-formed?  2. is this caller allowed to see this user?
// Lenders get 403 here: they use the anonymised /lender routes instead.
router.param('id', (req, res, next, id) => {
  assertUserId(id);
  assertCanAccessUser(req.user, id);
  next();
});

// GET /users/what-if/scenarios -> presets for the UI (no :id, any logged-in user)
router.get('/what-if/scenarios', (req, res) => {
  res.json(Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label })));
});

// GET /users/USR_001/score
router.get('/:id/score', async (req, res) => {
  res.json(await getCurrentScore(req.params.id, actorOf(req)));
});

// GET /users/USR_001/score/history
router.get('/:id/score/history', async (req, res) => {
  res.json({ user_id: req.params.id, history: await getScoreHistory(req.params.id) });
});

// GET /users/USR_001/products
router.get('/:id/products', async (req, res) => {
  const { score, risk_band } = await getCurrentScore(req.params.id, actorOf(req));
  res.json({ user_id: req.params.id, score, risk_band, ...(await productsForScore(score)) });
});

// GET /users/USR_001/transactions?month=2023-06&category=Rent&status=Late&page=1&limit=20
router.get('/:id/transactions', async (req, res) => {
  res.json(await listTransactions(req.params.id, req.query, parsePagination(req.query)));
});

// POST /users/USR_001/what-if  body: { "scenario": "autopay" } and/or { "changes": {...} }
router.post('/:id/what-if', async (req, res) => {
  const { scenario, params, changes } = req.body || {};
  res.json(await simulate(req.params.id, { scenario, params, changes }, actorOf(req)));
});

// GET /users/USR_001/offers -> offers lenders have sent to me
router.get('/:id/offers', async (req, res) => {
  res.json(await listUserOffers(req.params.id));
});

// POST /users/USR_001/offers/12/reject -> only the user themself (not even admin) can respond
router.post('/:id/offers/:offerId/reject', requireRole('user'), async (req, res) => {
  res.json(await rejectOffer(req.params.id, req.params.offerId, actorOf(req)));
});

// POST /users/USR_001/offers/12/accept -> calls the partner bank; only the user themself
router.post('/:id/offers/:offerId/accept', requireRole('user'), async (req, res) => {
  res.json(await acceptOffer(req.params.id, req.params.offerId, actorOf(req)));
});

// GET /users/USR_001/report.pdf -> downloadable transparency report
router.get('/:id/report.pdf', async (req, res) => {
  // 1. Gather data FIRST. If this throws (e.g. 404), headers are not sent yet,
  //    so the errorHandler can still reply with normal JSON.
  const data = await buildReportData(req.params.id, actorOf(req), 'pdf');

  // 2. Only now switch the response to PDF and stream it.
  //    "attachment" makes the browser download it instead of opening it.
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="altcredit-${req.params.id}-${data.report_id}.pdf"`);
  renderTransparencyPdf(data, res);
});

// GET /users/USR_001/profile.json -> same data as the PDF, machine-readable export
router.get('/:id/profile.json', async (req, res) => {
  const data = await buildReportData(req.params.id, actorOf(req), 'json');
  res.setHeader('Content-Disposition', `attachment; filename="altcredit-${req.params.id}-profile.json"`);
  res.json(data);
});


module.exports = router;