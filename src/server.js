const path = require('path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
require('./db'); // ensures schema + seed data exist before anything else runs

const smsRoutes = require('./routes/sms');
const apiRoutes = require('./routes/api');
const scheduler = require('./scheduler');

const app = express();
app.set('trust proxy', true);

// Twilio posts application/x-www-form-urlencoded
app.use('/sms', express.urlencoded({ extended: false }), smsRoutes);

// Public, unauthenticated page for Twilio's toll-free/A2P consent-language check
app.get('/opt-in', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'opt-in.html'));
});

// Login page and handler are unauthenticated by definition.
app.get('/login', (req, res) => {
  if (auth.isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { username, password } = req.body;
  if (!auth.checkCredentials(username, password)) {
    return res.redirect('/login?error=1');
  }
  const sessionId = auth.createSession();
  auth.setSessionCookie(req, res, sessionId);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/login');
});

app.use('/api', auth.requireLogin, express.json(), apiRoutes);
app.use('/', auth.requireLogin, express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`[server] Listening on port ${config.port}`);
  scheduler.start();
});
