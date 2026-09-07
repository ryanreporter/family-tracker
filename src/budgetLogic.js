const db = require('./db');
const config = require('./config');
const { nowIso, periodStartUtcIso, periodKey } = require('./time');
const { broadcast } = require('./twilioClient');

function allBuckets() {
  return db.prepare('SELECT * FROM budget_buckets ORDER BY sort_order').all();
}

function getBucket(id) {
  return db.prepare('SELECT * FROM budget_buckets WHERE id = ?').get(id);
}

function findBucketByName(name) {
  const buckets = allBuckets().filter((b) => !b.is_topline);
  const normalized = (name || '').trim().toLowerCase();
  let match = buckets.find((b) => b.name.toLowerCase() === normalized);
  if (!match) {
    match = buckets.find(
      (b) => b.name.toLowerCase().includes(normalized) || normalized.includes(b.name.toLowerCase())
    );
  }
  return match || null;
}

function spentSince(bucketId, sinceUtcIso) {
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM budget_transactions WHERE bucket_id = ? AND created_at >= ?'
    )
    .get(bucketId, sinceUtcIso);
  return row.total;
}

// The topline bucket has no transactions of its own — it represents the sum
// of spending across every regular bucket, so it's totalled separately.
function toplineSpentSince(sinceUtcIso) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(t.amount), 0) AS total
       FROM budget_transactions t
       JOIN budget_buckets b ON b.id = t.bucket_id
       WHERE b.is_topline = 0 AND t.created_at >= ?`
    )
    .get(sinceUtcIso);
  return row.total;
}

function bucketStatus(bucket) {
  const since = periodStartUtcIso(bucket.period);
  const spent = bucket.is_topline ? toplineSpentSince(since) : spentSince(bucket.id, since);
  return {
    id: bucket.id,
    name: bucket.name,
    limit: bucket.limit_amount,
    period: bucket.period,
    isTopline: !!bucket.is_topline,
    spent,
    remaining: bucket.limit_amount - spent,
  };
}

function allStatuses() {
  return allBuckets().map(bucketStatus);
}

function recentTransactions(limit = 25) {
  return db
    .prepare(
      `SELECT t.id, t.amount, t.description, t.created_at, b.name AS bucket_name, p.name AS person_name
       FROM budget_transactions t
       JOIN budget_buckets b ON b.id = t.bucket_id
       LEFT JOIN people p ON p.id = t.person_id
       ORDER BY t.id DESC LIMIT ?`
    )
    .all(limit);
}

async function checkAndSendThresholdAlerts(bucket) {
  const status = bucketStatus(bucket);
  if (status.limit <= 0) return;
  const remainingPct = (status.remaining / status.limit) * 100;
  const key = periodKey(bucket.period);
  const numbers = config.people.map((p) => p.phone);

  // A single large transaction can jump straight past several thresholds at
  // once. Mark every crossed-and-unsent threshold as sent (so a later, smaller
  // transaction can't re-trigger one already passed), but only text out the
  // single most-severe one newly crossed.
  let mostSevereNewlyCrossed = null;
  for (const threshold of [0, 10, 15, 25]) {
    const crossed = threshold === 0 ? status.remaining <= 0 : remainingPct <= threshold;
    if (!crossed) continue;

    const already = db
      .prepare(
        'SELECT 1 FROM budget_alerts_sent WHERE bucket_id = ? AND period_key = ? AND threshold = ?'
      )
      .get(bucket.id, key, threshold);
    if (already) continue;

    db.prepare(
      'INSERT INTO budget_alerts_sent (bucket_id, period_key, threshold) VALUES (?, ?, ?)'
    ).run(bucket.id, key, threshold);

    if (mostSevereNewlyCrossed === null) mostSevereNewlyCrossed = threshold;
  }

  if (mostSevereNewlyCrossed !== null) {
    const threshold = mostSevereNewlyCrossed;
    const periodLabel = bucket.period === 'weekly' ? 'week' : 'month';
    const msg =
      threshold === 0
        ? `Budget alert: "${bucket.name}" is fully spent for this ${periodLabel}. Remaining: $${status.remaining.toFixed(2)} of $${status.limit.toFixed(2)}.`
        : `Budget alert: "${bucket.name}" is down to ${threshold}% remaining ($${status.remaining.toFixed(2)} of $${status.limit.toFixed(2)} left this ${periodLabel}).`;
    await broadcast(numbers, msg);
  }
}

async function applyTransactionToBucket(bucket, { amount, description, personId }) {
  db.prepare(
    'INSERT INTO budget_transactions (bucket_id, amount, description, person_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(bucket.id, amount, description || null, personId || null, nowIso());

  const bucketStat = bucketStatus(bucket);

  const topline = allBuckets().find((b) => b.is_topline);
  let toplineStat = null;
  if (topline) {
    toplineStat = bucketStatus(topline);
    await checkAndSendThresholdAlerts(topline);
  }

  return { ok: true, bucket: bucketStat, topline: toplineStat };
}

async function applyTransaction({ bucketName, amount, description, personId }) {
  const bucket = findBucketByName(bucketName);
  if (!bucket) {
    return { ok: false, error: `No budget bucket matching "${bucketName}"` };
  }
  return applyTransactionToBucket(bucket, { amount, description, personId });
}

async function applyTransactionById({ bucketId, amount, description, personId }) {
  const bucket = getBucket(bucketId);
  if (!bucket || bucket.is_topline) {
    return { ok: false, error: `No budget bucket with id ${bucketId}` };
  }
  return applyTransactionToBucket(bucket, { amount, description, personId });
}

// Deleting a transaction needs no separate rollback step: bucket and topline
// totals are always computed live via SUM over budget_transactions, so a
// deleted row simply stops counting toward either total on the next read.
function deleteTransaction(id) {
  const txn = db.prepare('SELECT bucket_id FROM budget_transactions WHERE id = ?').get(id);
  if (!txn) return null;
  db.prepare('DELETE FROM budget_transactions WHERE id = ?').run(id);

  const bucket = getBucket(txn.bucket_id);
  const topline = allBuckets().find((b) => b.is_topline);
  return {
    bucket: bucket ? bucketStatus(bucket) : null,
    topline: topline ? bucketStatus(topline) : null,
  };
}

function updateBucket(id, fields) {
  const bucket = getBucket(id);
  if (!bucket) return null;
  const name = fields.name ?? bucket.name;
  const limit_amount = fields.limit_amount ?? bucket.limit_amount;
  const period = fields.period ?? bucket.period;
  db.prepare(
    'UPDATE budget_buckets SET name = ?, limit_amount = ?, period = ? WHERE id = ?'
  ).run(name, limit_amount, period, id);
  return bucketStatus(getBucket(id));
}

module.exports = {
  allBuckets,
  allStatuses,
  findBucketByName,
  recentTransactions,
  applyTransaction,
  applyTransactionById,
  deleteTransaction,
  updateBucket,
  getBucket,
};
