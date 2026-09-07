const db = require('./db');
const { nowIso } = require('./time');

function addEntry({ personId, description }) {
  db.prepare(
    'INSERT INTO exercise_entries (person_id, description, created_at) VALUES (?, ?, ?)'
  ).run(personId, description, nowIso());
}

function recentEntries(limit = 50) {
  return db
    .prepare(
      `SELECT e.id, e.description, e.created_at, p.name AS person_name
       FROM exercise_entries e
       JOIN people p ON p.id = e.person_id
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(limit);
}

module.exports = { addEntry, recentEntries };
