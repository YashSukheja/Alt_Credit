const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parsePagination } = require('../utils/validation');
const { assertRef } = require('../utils/anonymise');
const { searchCandidates, getCandidate, sendOffers, listLenderOffers } = require('../services/lenderService');

const router = express.Router();

// Every route in this file: must be logged in AND be a lender
router.use(requireAuth, requireRole('lender'));

// GET /lender/candidates?minScore=650&band=Low%20Risk&city_tier=1&employment=Employed&sort=score_desc&page=1&limit=20
router.get('/candidates', async (req, res) => {
  res.json(await searchCandidates(req.query, parsePagination(req.query), req.user));
});

// GET /lender/candidates/C-3F9A1B2C7D -> anonymised score breakdown
router.get('/candidates/:ref', async (req, res) => {
  res.json(await getCandidate(assertRef(req.params.ref)));
});

// POST /lender/offers { "product_id": "P_03", "refs": ["C-...", "C-..."] }
router.post('/offers', async (req, res) => {
  res.status(201).json(await sendOffers(req.user, req.body || {}));
});

// GET /lender/offers?status=pending
router.get('/offers', async (req, res) => {
  res.json(await listLenderOffers(req.user, req.query));
});

module.exports = router;