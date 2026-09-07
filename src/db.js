const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    daily_calorie_limit INTEGER NOT NULL DEFAULT 1500
  );

  CREATE TABLE IF NOT EXISTS budget_buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    limit_amount REAL NOT NULL,
    period TEXT NOT NULL CHECK(period IN ('weekly','monthly')),
    is_topline INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS budget_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id INTEGER NOT NULL REFERENCES budget_buckets(id),
    amount REAL NOT NULL,
    description TEXT,
    person_id INTEGER REFERENCES people(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calorie_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    description TEXT,
    calories INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exercise_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budget_alerts_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id INTEGER NOT NULL,
    period_key TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    UNIQUE(bucket_id, period_key, threshold)
  );

  CREATE TABLE IF NOT EXISTS calorie_alerts_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    UNIQUE(person_id, entry_date, alert_type)
  );
`);

function seed() {
  const countPeople = db.prepare('SELECT COUNT(*) AS n FROM people').get().n;
  if (countPeople === 0) {
    const insert = db.prepare(
      'INSERT INTO people (name, phone, daily_calorie_limit) VALUES (?, ?, ?)'
    );
    for (const p of config.people) {
      if (!p.phone) {
        throw new Error(
          `Missing phone number for ${p.name}. Set JOE_PHONE / HILLARY_PHONE in .env.`
        );
      }
      const defaultLimit = p.name === config.people[0].name ? 1500 : 1200;
      insert.run(p.name, p.phone, defaultLimit);
    }
  }

  const countBuckets = db.prepare('SELECT COUNT(*) AS n FROM budget_buckets').get().n;
  if (countBuckets === 0) {
    const insert = db.prepare(
      `INSERT INTO budget_buckets (name, limit_amount, period, is_topline, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    insert.run('Dining', 500, 'weekly', 0, 1);
    insert.run('Bucket 2', 200, 'weekly', 0, 2);
    insert.run('Bucket 3', 200, 'weekly', 0, 3);
    insert.run('Bucket 4', 100, 'weekly', 0, 4);
    insert.run('Total Budget', 1000, 'weekly', 1, 0);
  }
}

seed();

module.exports = db;
