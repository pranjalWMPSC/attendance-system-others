const express = require('express');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const okUser = username === process.env.ADMIN_USERNAME;
  const okPass = password === process.env.ADMIN_PASSWORD;
  if (okUser && okPass) {
    req.session.isAdmin = true;
    req.session.username = username;
    return res.json({ ok: true, username });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  return res.json({ authenticated: false });
});

module.exports = router;
