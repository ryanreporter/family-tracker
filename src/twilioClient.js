const twilio = require('twilio');
const config = require('./config');

const client =
  config.twilio.accountSid && config.twilio.authToken
    ? twilio(config.twilio.accountSid, config.twilio.authToken)
    : null;

async function sendSms(toNumber, body) {
  if (!client) {
    console.warn('[twilio] Not configured, skipping send:', toNumber, body);
    return;
  }
  try {
    await client.messages.create({
      to: toNumber,
      from: config.twilio.fromNumber,
      body,
    });
  } catch (err) {
    console.error('[twilio] Failed to send SMS to', toNumber, err.message);
  }
}

async function broadcast(numbers, body) {
  for (const n of numbers) {
    await sendSms(n, body);
  }
}

module.exports = { client, sendSms, broadcast };
