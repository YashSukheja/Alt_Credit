const express = require('express');
const { importDataset } = require('../importers/importDataset');
const { query } = require('../config/db');

const router = express.Router();

// TODO step 5: protect with requireAuth + requireRole('admin')

// POST /admin/import  -> loads all dataset files from server/data
router.post('/import', async (req, res) => {
  const result = await importDataset({ actor: 'admin' });
  res.status(201).json(result);
});

// GET /admin/import-runs -> history of imports with counts
router.get('/import-runs', async (req, res) => {
  const { rows } = await query(
    `SELECT id, file_name, total, accepted, rejected, created_at
     FROM import_runs ORDER BY id DESC LIMIT 20`,
  );
  res.json(rows);
});

module.exports = router;