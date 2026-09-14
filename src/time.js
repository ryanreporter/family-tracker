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

// The weekly reset moment: 11:59pm every Saturday, in the configured
// timezone. "This week" runs from the most recent occurrence of that moment
// up to (but not including) the next one.
function weekResetMoment(dt) {
  // Luxon weekday: 1=Mon..7=Sun, so Saturday = 6.
  let saturday = dt.set({ weekday: 6, hour: 23, minute: 59, second: 0, millisecond: 0 });
  if (dt < saturday) saturday = saturday.minus({ weeks: 1 });
  return saturday;
}

function weekPeriodStart() {
  return weekResetMoment(now());
}

function weekPeriodStartUtcIso() {
  return weekPeriodStart().toUTC().toISO();
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
  if (period === 'weekly') return weekPeriodStart().toISODate();
  return now().toFormat('yyyy-MM');
}

// The week that just closed at the most recent Saturday-11:59pm reset:
// [start, end) where end is the current period's start.
function previousWeekRange() {
  const endDt = weekPeriodStart();
  const startDt = endDt.minus({ weeks: 1 });
  return { startDt, endDt };
}

// A human title for an archived week, e.g. "Week of Sep 7 - Sep 13, 2026".
// startDt/endDt are the Saturday-23:59 boundaries; the displayed range is the
// calendar days in between (Sunday through the closing Saturday).
function weekLabel(startDt, endDt) {
  const displayStart = startDt.plus({ minutes: 1 });
  const displayEnd = endDt;
  const sameYear = displayStart.year === displayEnd.year;
  const startStr = displayStart.toFormat('MMM d');
  const endStr = sameYear ? displayEnd.toFormat('MMM d, yyyy') : displayEnd.toFormat('MMM d, yyyy');
  return sameYear
    ? `Week of ${startStr} - ${endStr}`
    : `Week of ${displayStart.toFormat('MMM d, yyyy')} - ${endStr}`;
}

module.exports = {
  now,
  nowIso,
  todayDateStr,
  periodStartUtcIso,
  periodKey,
  weekPeriodStart,
  previousWeekRange,
  weekLabel,
};
