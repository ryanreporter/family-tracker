require('dotenv').config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  return v;
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  timezone: process.env.TIMEZONE || 'America/Chicago',
  databasePath: required('DATABASE_PATH', './data/family-tracker.db'),

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  },

  usda: {
    apiKey: process.env.USDA_API_KEY || 'DEMO_KEY',
  },

  people: [
    { name: process.env.JOE_NAME || 'Joe', phone: process.env.JOE_PHONE },
    { name: process.env.HILLARY_NAME || 'Hillary', phone: process.env.HILLARY_PHONE },
  ],

  dashboard: {
    user: process.env.DASHBOARD_USER || 'family',
    pass: process.env.DASHBOARD_PASS || 'change-me',
  },

  lowCalorieThreshold: 200,
  budgetAlertThresholds: [25, 15, 10, 0], // percent remaining, checked high to low
};
