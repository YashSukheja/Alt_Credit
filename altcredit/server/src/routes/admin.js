const express = require('express');
const { importDataset } = require('../importers/importDataset');
const { query } = require('../config/db');
const { scoreAllUsers } = require('../services/scoreService');

// Admin-only actions: load data, score everyone, see import history
const router = express.Router();

// TODO step 5: protect with requireAuth + requireRole('admin')

// POST /admin/import -> validate + load all dataset files from server/data (step 2)
router.post('/import', async (req, res) => {
  const result = await importDataset({ actor: 'admin' });
  res.status(201).json(result); // 201 = "Created": new rows were written
});

// GET /admin/import-runs -> last 20 imports with accepted/rejected counts
router.get('/import-runs', async (req, res) => {
  const { rows } = await query(
    `SELECT id, file_name, total, accepted, rejected, created_at
     FROM import_runs ORDER BY id DESC LIMIT 20`,
  );
  res.json(rows);
});

// POST /admin/score-all -> score all 500 users and store results.
// Run once after every import, so lender search has stored scores to filter on.
router.post('/score-all', async (req, res) => {
  res.json(await scoreAllUsers('admin'));
});

module.exports = router;