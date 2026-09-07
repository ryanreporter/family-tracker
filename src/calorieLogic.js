const db = require('./db');
const config = require('./config');
const { nowIso, todayDateStr } = require('./time');
const { sendSms } = require('./twilioClient');

function allPeople() {
  return db.prepare('SELECT * FROM people').all();
}

function getPerson(id) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id);
}

function getPersonByName(name) {
  const normalized = (name || '').trim().toLowerCase();
  return allPeople().find((p) => p.name.toLowerCase() === normalized) || null;
}

function getPersonByPhone(phone) {
  return db.prepare('SELECT * FROM people WHERE phone = ?').get(phone) || null;
}

function consumedToday(personId) {
  const today = todayDateStr();
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(calories), 0) AS total FROM calorie_entries WHERE person_id = ? AND entry_date = ?'
    )
    .get(personId, today);
  return row.total;
}

function personStatus(person) {
  const consumed = consumedToday(person.id);
  return {
    id: person.id,
    name: person.name,
    limit: person.daily_calorie_limit,
    consumed,
    remaining: person.daily_calorie_limit - consumed,
  };
}

function todaysEntries(personId) {
  const today = todayDateStr();
  return db
    .prepare(
      'SELECT id, description, calories, created_at FROM calorie_entries WHERE person_id = ? AND entry_date = ? ORDER BY id DESC'
    )
    .all(personId, today);
}

async function addEntry({ personId, calories, description }) {
  db.prepare(
    'INSERT INTO calorie_entries (person_id, description, calories, entry_date, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(personId, description || null, Math.round(calories), todayDateStr(), nowIso());

  const person = getPerson(personId);
  const status = personStatus(person);
  await maybeSendLowAlert(person, status);
  return status;
}

async function maybeSendLowAlert(person, status) {
  if (status.remaining >= config.lowCalorieThreshold) return;
  const today = todayDateStr();
  const already = db
    .prepare(
      'SELECT 1 FROM calorie_alerts_sent WHERE person_id = ? AND entry_date = ? AND alert_type = ?'
    )
    .get(person.id, today, 'low');
  if (already) return;

  db.prepare(
    'INSERT INTO calorie_alerts_sent (person_id, entry_date, alert_type) VALUES (?, ?, ?)'
  ).run(person.id, today, 'low');

  await sendSms(
    person.phone,
    `Calorie alert: you have ${status.remaining} calorie${status.remaining === 1 ? '' : 's'} left today (limit ${status.limit}).`
  );
}

// Consumed/remaining are always computed live via SUM over calorie_entries,
// so a deleted row simply stops counting on the next read.
function deleteEntry(id) {
  const entry = db.prepare('SELECT person_id FROM calorie_entries WHERE id = ?').get(id);
  if (!entry) return null;
  db.prepare('DELETE FROM calorie_entries WHERE id = ?').run(id);
  const person = getPerson(entry.person_id);
  return person ? personStatus(person) : null;
}

async function updatePersonLimit(id, dailyLimit) {
  const person = getPerson(id);
  if (!person) return null;
  db.prepare('UPDATE people SET daily_calorie_limit = ? WHERE id = ?').run(dailyLimit, id);
  const updatedPerson = getPerson(id);
  const status = personStatus(updatedPerson);
  await maybeSendLowAlert(updatedPerson, status);
  return status;
}

module.exports = {
  allPeople,
  getPerson,
  getPersonByName,
  getPersonByPhone,
  personStatus,
  todaysEntries,
  addEntry,
  deleteEntry,
  updatePersonLimit,
  maybeSendLowAlert,
};
