const express = require('express');
const { login } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /auth/login { "username": "usr001", "password": "..." } -> { token, account }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  res.json(await login(username, password));
});

// GET /auth/me -> who does this token belong to? (frontend calls this on page load)
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;