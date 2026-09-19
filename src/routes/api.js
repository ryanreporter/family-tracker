const express = require('express');
const budgetLogic = require('../budgetLogic');
const calorieLogic = require('../calorieLogic');
const exerciseLogic = require('../exerciseLogic');
const archiveLogic = require('../archiveLogic');
const upcomingLogic = require('../upcomingLogic');
const config = require('../config');

const router = express.Router();

function requireFeature(name) {
  return (req, res, next) => {
    if (!config.features[name]) return res.status(404).json({ error: `${name} tracking is turned off` });
    next();
  };
}

router.get('/state', (req, res) => {
  const buckets = budgetLogic.allStatuses();
  const topline = buckets.find((b) => b.isTopline);
  const regularBuckets = buckets.filter((b) => !b.isTopline);

  const state = {
    features: config.features,
    people: calorieLogic.allPeople().map((p) => ({ id: p.id, name: p.name })),
    budget: {
      topline,
      buckets: regularBuckets,
      recentTransactions: budgetLogic.recentTransactions(25),
    },
    upcoming: { recipients: upcomingLogic.RECIPIENTS, items: upcomingLogic.listItems() },
  };

  if (config.features.calories) {
    state.calories = {
      people: calorieLogic.allPeople().map((p) => ({
        ...calorieLogic.personStatus(p),
        entries: calorieLogic.todaysEntries(p.id),
      })),
    };
  }
  if (config.features.exercise) {
    state.exercise = { entries: exerciseLogic.recentEntries(50) };
  }

  res.json(state);
});

router.patch('/budget/buckets/:id', (req, res) => {
  const { name, limit_amount, period } = req.body;
  if (period && !['weekly', 'monthly'].includes(period)) {
    return res.status(400).json({ error: 'period must be weekly or monthly' });
  }
  const updated = budgetLogic.updateBucket(Number(req.params.id), {
    name,
    limit_amount: limit_amount != null ? Number(limit_amount) : undefined,
    period,
  });
  if (!updated) return res.status(404).json({ error: 'bucket not found' });
  res.json(updated);
});

router.patch('/calories/people/:id', requireFeature('calories'), async (req, res) => {
  const { daily_calorie_limit } = req.body;
  if (daily_calorie_limit == null || isNaN(Number(daily_calorie_limit))) {
    return res.status(400).json({ error: 'daily_calorie_limit must be a number' });
  }
  const updated = await calorieLogic.updatePersonLimit(Number(req.params.id), Number(daily_calorie_limit));
  if (!updated) return res.status(404).json({ error: 'person not found' });
  res.json(updated);
});

// --- Manual entry (dashboard forms), same logic paths as the SMS webhook ---

router.post('/budget/transactions', async (req, res) => {
  const { bucket_id, amount, description, person_id } = req.body;
  const bucketId = Number(bucket_id);
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const result = await budgetLogic.applyTransactionById({
    bucketId,
    amount: amountNum,
    description,
    personId: person_id ? Number(person_id) : null,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/calories/entries', requireFeature('calories'), async (req, res) => {
  const { person_id, calories, description } = req.body;
  const caloriesNum = Number(calories);
  if (!person_id || !Number.isFinite(caloriesNum)) {
    return res.status(400).json({ error: 'person_id and a numeric calories value are required' });
  }
  const status = await calorieLogic.addEntry({
    personId: Number(person_id),
    calories: caloriesNum,
    description: description || 'manual entry',
  });
  res.json(status);
});

router.post('/exercise/entries', requireFeature('exercise'), (req, res) => {
  const { person_id, description } = req.body;
  if (!person_id || !description || !description.trim()) {
    return res.status(400).json({ error: 'person_id and description are required' });
  }
  exerciseLogic.addEntry({ personId: Number(person_id), description: description.trim() });
  res.json({ ok: true });
});

// --- Deletions: totals are always computed live, so a delete immediately
// rolls the entry off the relevant bucket/topline/calorie total. ---

router.delete('/budget/transactions/:id', (req, res) => {
  const result = budgetLogic.deleteTransaction(Number(req.params.id));
  if (!result) return res.status(404).json({ error: 'transaction not found' });
  res.json(result);
});

router.delete('/calories/entries/:id', requireFeature('calories'), (req, res) => {
  const status = calorieLogic.deleteEntry(Number(req.params.id));
  if (!status) return res.status(404).json({ error: 'entry not found' });
  res.json(status);
});

// --- Upcoming expenses / items needed: stay until deleted (never archived or pruned). ---

router.post('/upcoming', (req, res) => {
  const { description, estimated_cost, for_person } = req.body;
  const cost = Number(estimated_cost);
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  if (estimated_cost === '' || estimated_cost == null || !Number.isFinite(cost) || cost < 0) {
    return res.status(400).json({ error: 'estimated cost must be a number, 0 or more' });
  }
  if (!upcomingLogic.RECIPIENTS.includes(for_person)) {
    return res.status(400).json({ error: 'pick who the item is for' });
  }
  upcomingLogic.addItem({ description: description.trim(), estimatedCost: cost, forPerson: for_person });
  res.json({ ok: true });
});

router.delete('/upcoming/:id', (req, res) => {
  if (!upcomingLogic.deleteItem(Number(req.params.id))) {
    return res.status(404).json({ error: 'item not found' });
  }
  res.json({ ok: true });
});

// --- Weekly archive: normally runs automatically every Saturday 11:59pm,
// but can also be triggered early from the dashboard. ---

router.get('/archives', (req, res) => {
  res.json(archiveLogic.listArchives());
});

router.get('/archives/:id', (req, res) => {
  const archive = archiveLogic.getArchive(Number(req.params.id));
  if (!archive) return res.status(404).json({ error: 'archive not found' });
  res.json(archive);
});

router.post('/archives/reset-now', (req, res) => {
  const result = archiveLogic.resetNow();
  res.json(result);
});

module.exports = router;
