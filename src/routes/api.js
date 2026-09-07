const express = require('express');
const budgetLogic = require('../budgetLogic');
const calorieLogic = require('../calorieLogic');
const exerciseLogic = require('../exerciseLogic');

const router = express.Router();

router.get('/state', (req, res) => {
  const buckets = budgetLogic.allStatuses();
  const topline = buckets.find((b) => b.isTopline);
  const regularBuckets = buckets.filter((b) => !b.isTopline);

  const people = calorieLogic.allPeople().map((p) => {
    const status = calorieLogic.personStatus(p);
    return { ...status, entries: calorieLogic.todaysEntries(p.id) };
  });

  res.json({
    budget: {
      topline,
      buckets: regularBuckets,
      recentTransactions: budgetLogic.recentTransactions(25),
    },
    calories: { people },
    exercise: { entries: exerciseLogic.recentEntries(50) },
  });
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

router.patch('/calories/people/:id', async (req, res) => {
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

router.post('/calories/entries', async (req, res) => {
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

router.post('/exercise/entries', (req, res) => {
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

router.delete('/calories/entries/:id', (req, res) => {
  const status = calorieLogic.deleteEntry(Number(req.params.id));
  if (!status) return res.status(404).json({ error: 'entry not found' });
  res.json(status);
});

module.exports = router;
