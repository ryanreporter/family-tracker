const { DateTime } = require('luxon');
const { timezone } = require('./config');

function now() {
  return DateTime.now().setZone(timezone);
}

function nowIso() {
  return new Date().toISOString();
}

function todayDateStr() {
  return now().toISODate();
}

// Monday 00:00 in the configured timezone, as a UTC ISO instant string
// (comparable lexicographically against created_at values, which are also
// stored as UTC ISO strings).
function weekPeriodStartUtcIso() {
  const n = now();
  const monday = n.minus({ days: n.weekday - 1 }).startOf('day');
  return monday.toUTC().toISO();
}

function monthPeriodStartUtcIso() {
  const n = now().startOf('month');
  return n.toUTC().toISO();
}

function periodStartUtcIso(period) {
  return period === 'weekly' ? weekPeriodStartUtcIso() : monthPeriodStartUtcIso();
}

// A stable key identifying "which period we're in", used to dedupe alerts.
function periodKey(period) {
  const n = now();
  if (period === 'weekly') {
    const monday = n.minus({ days: n.weekday - 1 }).startOf('day');
    return monday.toISODate();
  }
  return n.toFormat('yyyy-MM');
}

module.exports = {
  now,
  nowIso,
  todayDateStr,
  periodStartUtcIso,
  periodKey,
};
