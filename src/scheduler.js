const cron = require('node-cron');
const config = require('./config');
const db = require('./db');
const { todayDateStr } = require('./time');
const calorieLogic = require('./calorieLogic');
const { sendSms } = require('./twilioClient');

async function sendDailySummaries() {
  const today = todayDateStr();
  for (const person of calorieLogic.allPeople()) {
    const already = db
      .prepare(
        'SELECT 1 FROM calorie_alerts_sent WHERE person_id = ? AND entry_date = ? AND alert_type = ?'
      )
      .get(person.id, today, 'summary');
    if (already) continue;

    const status = calorieLogic.personStatus(person);
    db.prepare(
      'INSERT INTO calorie_alerts_sent (person_id, entry_date, alert_type) VALUES (?, ?, ?)'
    ).run(person.id, today, 'summary');

    await sendSms(
      person.phone,
      `9pm summary: ${status.consumed} of ${status.limit} calories used today. Remaining: ${status.remaining}.`
    );
  }
}

async function checkLowCalorieAlerts() {
  // addEntry (and updatePersonLimit) already send this alert at write-time;
  // this periodic sweep is just a safety net in case a process restart
  // caused one of those writes to skip the check.
  for (const person of calorieLogic.allPeople()) {
    const status = calorieLogic.personStatus(person);
    await calorieLogic.maybeSendLowAlert(person, status);
  }
}

function start() {
  cron.schedule('0 21 * * *', sendDailySummaries, { timezone: config.timezone });
  cron.schedule('*/10 * * * *', checkLowCalorieAlerts, { timezone: config.timezone });
  console.log(`[scheduler] Started (timezone ${config.timezone}): 9pm summary + 10-min low-calorie sweep.`);
}

module.exports = { start, sendDailySummaries, checkLowCalorieAlerts };
