const express = require('express');
const { importDataset } = require('../importers/importDataset');
const { query } = require('../config/db');
const { scoreAllUsers } = require('../services/scoreService');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parsePagination } = require('../utils/validation');

const router = express.Router();

// Every route in this file: must be logged in AND be an admin
router.use(requireAuth, requireRole('admin'));

// POST /admin/import -> validate + load all dataset files from server/data
router.post('/import', async (req, res) => {
  res.status(201).json(await importDataset({ actor: req.user.username }));
});

// GET /admin/import-runs -> last 20 imports with accepted/rejected counts
router.get('/import-runs', async (req, res) => {
  const { rows } = await query(
    `SELECT id, file_name, total, accepted, rejected, created_at
     FROM import_runs ORDER BY id DESC LIMIT 20`,
  );
  res.json(rows);
});

// POST /admin/score-all -> score every user and store results
router.post('/score-all', async (req, res) => {
  res.json(await scoreAllUsers(req.user.username));
});

// GET /admin/audit?action=OFFER_SENT&actor=lender1&page=1&limit=50 -> who did what, when
router.get('/audit', async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  if (req.query.action) { params.push(req.query.action); where.push(`action = $${params.length}`); }
  if (req.query.actor) { params.push(req.query.actor); where.push(`actor = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT id, actor, action, entity, entity_id, details, created_at, count(*) OVER () AS total
     FROM audit_log ${whereSql}
     ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  res.json({
    page, limit, total: rows.length ? Number(rows[0].total) : 0,
    results: rows.map(({ total, ...r }) => r),
  });
});

module.exports = router;