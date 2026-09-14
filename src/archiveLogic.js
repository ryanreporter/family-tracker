const db = require('./db');
const { nowIso, now, weekPeriodStart, previousWeekRange, weekLabel } = require('./time');

// Archives budget/calorie/exercise activity in [weekStartIso, cutoffIso) under
// weekKey, merging into any archive already stored for that key (so calling
// this more than once for the same week — e.g. a manual reset followed by
// the normal Saturday job — accumulates rather than overwrites), then clears
// the archived rows out of the live tables so totals actually reset.
//
// Budget transactions are only archived/cleared for 'weekly' buckets:
// monthly buckets keep accumulating all month, and their status is computed
// live from the whole month's transactions, so clearing mid-month would
// wrongly zero them out. Weekly buckets reset for free once the calendar
// boundary passes (see time.js), so clearing them here is just housekeeping
// plus what makes an early/manual reset visible immediately.
function archiveRange({ weekStartIso, cutoffIso, weekEndIso, weekKey, title }) {
  const transactions = db
    .prepare(
      `SELECT t.amount, t.description, t.created_at, b.name AS bucket_name, p.name AS person_name
       FROM budget_transactions t
       JOIN budget_buckets b ON b.id = t.bucket_id
       LEFT JOIN people p ON p.id = t.person_id
       WHERE b.is_topline = 0 AND b.period = 'weekly' AND t.created_at >= ? AND t.created_at < ?
       ORDER BY t.created_at`
    )
    .all(weekStartIso, cutoffIso);

  const calorieEntries = db
    .prepare(
      `SELECT c.calories, c.description, c.entry_date, c.created_at, p.name AS person_name
       FROM calorie_entries c
       JOIN people p ON p.id = c.person_id
       WHERE c.created_at >= ? AND c.created_at < ?
       ORDER BY c.created_at`
    )
    .all(weekStartIso, cutoffIso);

  const exerciseEntries = db
    .prepare(
      `SELECT e.description, e.created_at, p.name AS person_name
       FROM exercise_entries e
       JOIN people p ON p.id = e.person_id
       WHERE e.created_at >= ? AND e.created_at < ?
       ORDER BY e.created_at`
    )
    .all(weekStartIso, cutoffIso);

  const newSpent = transactions.reduce((sum, t) => sum + t.amount, 0);
  const existing = db.prepare('SELECT data, total_spent FROM weekly_archives WHERE week_key = ?').get(weekKey);

  let merged = { transactions, calorieEntries, exerciseEntries };
  let totalSpent = newSpent;
  if (existing) {
    const prev = JSON.parse(existing.data);
    merged = {
      transactions: [...prev.transactions, ...transactions],
      calorieEntries: [...prev.calorieEntries, ...calorieEntries],
      exerciseEntries: [...prev.exerciseEntries, ...exerciseEntries],
    };
    totalSpent = existing.total_spent + newSpent;
  }

  db.prepare(
    `INSERT INTO weekly_archives (week_key, title, week_start, week_end, total_spent, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_key) DO UPDATE SET
       title = excluded.title,
       week_end = excluded.week_end,
       total_spent = excluded.total_spent,
       data = excluded.data,
       created_at = excluded.created_at`
  ).run(weekKey, title, weekStartIso, weekEndIso, totalSpent, JSON.stringify(merged), nowIso());

  db.prepare(
    `DELETE FROM budget_transactions WHERE id IN (
       SELECT t.id FROM budget_transactions t
       JOIN budget_buckets b ON b.id = t.bucket_id
       WHERE b.is_topline = 0 AND b.period = 'weekly' AND t.created_at >= ? AND t.created_at < ?
     )`
  ).run(weekStartIso, cutoffIso);
  db.prepare('DELETE FROM calorie_entries WHERE created_at >= ? AND created_at < ?').run(weekStartIso, cutoffIso);
  db.prepare('DELETE FROM exercise_entries WHERE created_at >= ? AND created_at < ?').run(weekStartIso, cutoffIso);

  return {
    weekKey,
    title,
    counts: { transactions: transactions.length, calorieEntries: calorieEntries.length, exerciseEntries: exerciseEntries.length },
  };
}

// The automatic Saturday-11:59pm job: archives the week that just closed.
// Safe to run more than once for the same week (e.g. a process restart) —
// archiveRange deletes rows as it archives them, so a repeat run simply
// finds nothing new to add.
function archivePreviousWeek() {
  const { startDt, endDt } = previousWeekRange();
  const weekKey = startDt.toISODate();
  return archiveRange({
    weekStartIso: startDt.toUTC().toISO(),
    cutoffIso: endDt.toUTC().toISO(),
    weekEndIso: endDt.toUTC().toISO(),
    weekKey,
    title: weekLabel(startDt, endDt),
  });
}

// Manual, immediate reset: archives everything logged so far in the
// currently-open week (even though the calendar boundary hasn't hit
// Saturday 11:59pm yet) and clears it so the dashboard reads zero right now.
// Anything logged later this week merges into the same archive entry when
// the normal Saturday job (or another manual reset) runs.
function resetNow() {
  const startDt = weekPeriodStart();
  const endDt = startDt.plus({ weeks: 1 });
  const cutoffDt = now();
  const weekKey = startDt.toISODate();
  return archiveRange({
    weekStartIso: startDt.toUTC().toISO(),
    cutoffIso: cutoffDt.toUTC().toISO(),
    weekEndIso: endDt.toUTC().toISO(),
    weekKey,
    title: weekLabel(startDt, endDt),
  });
}

function listArchives() {
  return db
    .prepare(
      `SELECT id, week_key, title, week_start, week_end, total_spent, created_at
       FROM weekly_archives ORDER BY week_start DESC`
    )
    .all();
}

function getArchive(id) {
  const row = db.prepare('SELECT * FROM weekly_archives WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data) };
}

// Archived weeks (and any remaining raw rows behind them, e.g. monthly-bucket
// transactions) are kept for at least 3 months, then rolled off. Live
// weekly/monthly totals only ever depend on data from the currently-open
// period (at most a few weeks back), so this is always safe to run against
// anything older than 3 months.
function pruneOlderThan3Months() {
  const cutoffIso = now().minus({ months: 3 }).toUTC().toISO();
  db.prepare('DELETE FROM budget_transactions WHERE created_at < ?').run(cutoffIso);
  db.prepare('DELETE FROM calorie_entries WHERE created_at < ?').run(cutoffIso);
  db.prepare('DELETE FROM exercise_entries WHERE created_at < ?').run(cutoffIso);
  db.prepare('DELETE FROM weekly_archives WHERE week_end < ?').run(cutoffIso);
}

module.exports = {
  archivePreviousWeek,
  resetNow,
  listArchives,
  getArchive,
  pruneOlderThan3Months,
};
