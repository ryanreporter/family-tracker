const cron = require('node-cron');
const config = require('./config');
const db = require('./db');
const { todayDateStr } = require('./time');
const calorieLogic = require('./calorieLogic');
const archiveLogic = require('./archiveLogic');
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

// Fires at 11:59pm every Saturday: snapshots the week that's ending into
// weekly_archives (so it stays browsable), then rolls off anything past the
// 3-month retention window. Weekly budget totals reset on their own right
// after this, since bucketStatus() computes "spent this week" from the new
// period boundary in time.js.
async function runWeeklyArchive() {
  try {
    const result = archiveLogic.archivePreviousWeek();
    archiveLogic.pruneOlderThan3Months();
    if (result) console.log(`[scheduler] Archived "${result.title}".`);
  } catch (err) {
    console.error('[scheduler] Weekly archive/reset failed:', err);
  }
}

function start() {
  if (config.features.calories) {
    cron.schedule('0 21 * * *', sendDailySummaries, { timezone: config.timezone });
    cron.schedule('*/10 * * * *', checkLowCalorieAlerts, { timezone: config.timezone });
  }
  cron.schedule('59 23 * * 6', runWeeklyArchive, { timezone: config.timezone });
  console.log(
    `[scheduler] Started (timezone ${config.timezone}): Saturday 11:59pm weekly archive/reset` +
      (config.features.calories ? ' + 9pm summary + 10-min low-calorie sweep.' : ' (calorie schedules off).')
  );
}

module.exports = { start, sendDailySummaries, checkLowCalorieAlerts, runWeeklyArchive };
