const db = require('./db');
const { nowIso, periodStartUtcIso } = require('./time');

function addEntry({ personId, description }) {
  db.prepare(
    'INSERT INTO exercise_entries (person_id, description, created_at) VALUES (?, ?, ?)'
  ).run(personId, description, nowIso());
}

// Scoped to the current week (since the last Saturday-11:59pm reset) so the
// dashboard list resets along with the weekly totals — older weeks live on
// in the archive instead.
function recentEntries(limit = 50) {
  const since = periodStartUtcIso('weekly');
  return db
    .prepare(
      `SELECT e.id, e.description, e.created_at, p.name AS person_name
       FROM exercise_entries e
       JOIN people p ON p.id = e.person_id
       WHERE e.created_at >= ?
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(since, limit);
}

module.exports = { addEntry, recentEntries };
