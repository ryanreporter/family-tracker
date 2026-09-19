const db = require('./db');
const { nowIso } = require('./time');

const RECIPIENTS = ['Hillary', 'Joe', 'Connor', 'Nora', 'Tommy', 'Alex', 'Tristan', 'Other'];

function listItems() {
  return db
    .prepare('SELECT id, description, estimated_cost, for_person, created_at FROM upcoming_items ORDER BY id DESC')
    .all();
}

function addItem({ description, estimatedCost, forPerson }) {
  db.prepare(
    'INSERT INTO upcoming_items (description, estimated_cost, for_person, created_at) VALUES (?, ?, ?, ?)'
  ).run(description, estimatedCost, forPerson, nowIso());
}

function deleteItem(id) {
  const result = db.prepare('DELETE FROM upcoming_items WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = { RECIPIENTS, listItems, addItem, deleteItem };
