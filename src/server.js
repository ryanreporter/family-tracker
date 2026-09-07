const path = require('path');
const express = require('express');
const basicAuth = require('express-basic-auth');
const config = require('./config');
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

const dashboardAuth = basicAuth({
  users: { [config.dashboard.user]: config.dashboard.pass },
  challenge: true,
  realm: 'family-tracker',
});

app.use('/api', dashboardAuth, express.json(), apiRoutes);
app.use('/', dashboardAuth, express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`[server] Listening on port ${config.port}`);
  scheduler.start();
});
