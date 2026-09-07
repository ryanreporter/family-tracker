const POLL_MS = 5000;

function fmtMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}

function remainingClass(remaining) {
  return remaining < 0 ? 'negative' : 'positive';
}

function timeAgo(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

async function patchJson(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}
    throw new Error(message);
  }
  return res.json();
}

// Rebuilds a <select>'s options only when the underlying id set changes, so
// an in-progress user selection survives the 5-second poll refresh.
function populateSelect(selectEl, items, valueKey, labelKey) {
  const idsKey = items.map((i) => i[valueKey]).join(',');
  if (selectEl.dataset.ids === idsKey) return;
  const prevValue = selectEl.value;
  selectEl.innerHTML = items.map((i) => `<option value="${i[valueKey]}">${i[labelKey]}</option>`).join('');
  selectEl.dataset.ids = idsKey;
  if (items.some((i) => String(i[valueKey]) === prevValue)) selectEl.value = prevValue;
}

function showFormMsg(el, message, isError) {
  el.textContent = message;
  el.classList.toggle('error', !!isError);
  if (!isError) setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 4000);
}

function renderTopline(topline) {
  const el = document.getElementById('topline');
  if (!topline) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="bucket-name">${topline.name} (${topline.period})</div>
    <div class="remaining ${remainingClass(topline.remaining)}">${fmtMoney(topline.remaining)} left of ${fmtMoney(topline.limit)}</div>
    <div class="edit-row" data-id="${topline.id}">
      <input type="text" class="f-name" value="${topline.name}" />
      <input type="number" step="0.01" class="f-limit" value="${topline.limit}" />
      <select class="f-period">
        <option value="weekly" ${topline.period === 'weekly' ? 'selected' : ''}>weekly</option>
        <option value="monthly" ${topline.period === 'monthly' ? 'selected' : ''}>monthly</option>
      </select>
      <button class="save-bucket">Save</button>
    </div>
  `;
  wireBucketEditRow(el.querySelector('.edit-row'));
}

function renderBuckets(buckets) {
  const el = document.getElementById('buckets');
  el.innerHTML = buckets.map((b) => `
    <div class="card">
      <div class="bucket-name">${b.name} (${b.period})</div>
      <div class="remaining ${remainingClass(b.remaining)}">${fmtMoney(b.remaining)} left of ${fmtMoney(b.limit)}</div>
      <div class="edit-row" data-id="${b.id}">
        <input type="text" class="f-name" value="${b.name}" />
        <input type="number" step="0.01" class="f-limit" value="${b.limit}" />
        <select class="f-period">
          <option value="weekly" ${b.period === 'weekly' ? 'selected' : ''}>weekly</option>
          <option value="monthly" ${b.period === 'monthly' ? 'selected' : ''}>monthly</option>
        </select>
        <button class="save-bucket">Save</button>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('.edit-row').forEach(wireBucketEditRow);
}

function wireBucketEditRow(row) {
  row.querySelector('.save-bucket').addEventListener('click', async () => {
    const id = row.dataset.id;
    const name = row.querySelector('.f-name').value;
    const limit_amount = row.querySelector('.f-limit').value;
    const period = row.querySelector('.f-period').value;
    await patchJson(`/api/budget/buckets/${id}`, { name, limit_amount, period });
    load();
  });
}

function renderTransactions(txns) {
  const el = document.getElementById('transactions');
  el.innerHTML = txns.map((t) => `
    <li>
      ${fmtMoney(t.amount)} — ${t.bucket_name} — ${t.description || ''}
      <div class="meta">${t.person_name || 'unknown'} · ${timeAgo(t.created_at)}</div>
    </li>
  `).join('') || '<li class="meta">No transactions yet.</li>';
}

function renderCaloriePeople(people) {
  const el = document.getElementById('calorie-people');
  el.innerHTML = people.map((p) => `
    <div class="card">
      <div class="bucket-name">${p.name}</div>
      <div class="remaining ${remainingClass(p.remaining)}">${p.remaining} cal left of ${p.limit}</div>
      <div class="edit-row" data-id="${p.id}">
        <input type="number" class="f-limit" value="${p.limit}" />
        <button class="save-person">Save daily limit</button>
      </div>
      <h3>Today</h3>
      <ul class="list">
        ${p.entries.map((e) => `<li>${e.calories} cal — ${e.description || ''}<div class="meta">${timeAgo(e.created_at)}</div></li>`).join('') || '<li class="meta">Nothing logged today.</li>'}
      </ul>
    </div>
  `).join('');
  el.querySelectorAll('.edit-row').forEach((row) => {
    row.querySelector('.save-person').addEventListener('click', async () => {
      const id = row.dataset.id;
      const daily_calorie_limit = row.querySelector('.f-limit').value;
      await patchJson(`/api/calories/people/${id}`, { daily_calorie_limit });
      load();
    });
  });
}

function renderExercise(entries) {
  const el = document.getElementById('exercise-entries');
  el.innerHTML = entries.map((e) => `
    <li>${e.description}<div class="meta">${e.person_name} · ${timeAgo(e.created_at)}</div></li>
  `).join('') || '<li class="meta">No exercise logged yet.</li>';
}

function populateEntryFormDropdowns(data) {
  populateSelect(document.getElementById('budget-entry-bucket'), data.budget.buckets, 'id', 'name');
  populateSelect(document.getElementById('budget-entry-person'), data.calories.people, 'id', 'name');
  populateSelect(document.getElementById('calorie-entry-person'), data.calories.people, 'id', 'name');
  populateSelect(document.getElementById('exercise-entry-person'), data.calories.people, 'id', 'name');
}

async function load() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const data = await res.json();
    renderTopline(data.budget.topline);
    renderBuckets(data.budget.buckets);
    renderTransactions(data.budget.recentTransactions);
    renderCaloriePeople(data.calories.people);
    renderExercise(data.exercise.entries);
    populateEntryFormDropdowns(data);
  } catch (err) {
    console.error('Failed to load state', err);
  }
}

function wireEntryForms() {
  document.getElementById('budget-entry-submit').addEventListener('click', async () => {
    const msgEl = document.getElementById('budget-entry-msg');
    const bucket_id = document.getElementById('budget-entry-bucket').value;
    const amount = document.getElementById('budget-entry-amount').value;
    const description = document.getElementById('budget-entry-description').value;
    const person_id = document.getElementById('budget-entry-person').value;
    try {
      await postJson('/api/budget/transactions', { bucket_id, amount, description, person_id });
      document.getElementById('budget-entry-amount').value = '';
      document.getElementById('budget-entry-description').value = '';
      showFormMsg(msgEl, 'Added.', false);
      load();
    } catch (err) {
      showFormMsg(msgEl, err.message, true);
    }
  });

  document.getElementById('calorie-entry-submit').addEventListener('click', async () => {
    const msgEl = document.getElementById('calorie-entry-msg');
    const person_id = document.getElementById('calorie-entry-person').value;
    const calories = document.getElementById('calorie-entry-calories').value;
    const description = document.getElementById('calorie-entry-description').value;
    try {
      await postJson('/api/calories/entries', { person_id, calories, description });
      document.getElementById('calorie-entry-calories').value = '';
      document.getElementById('calorie-entry-description').value = '';
      showFormMsg(msgEl, 'Added.', false);
      load();
    } catch (err) {
      showFormMsg(msgEl, err.message, true);
    }
  });

  document.getElementById('exercise-entry-submit').addEventListener('click', async () => {
    const msgEl = document.getElementById('exercise-entry-msg');
    const person_id = document.getElementById('exercise-entry-person').value;
    const description = document.getElementById('exercise-entry-description').value;
    try {
      await postJson('/api/exercise/entries', { person_id, description });
      document.getElementById('exercise-entry-description').value = '';
      showFormMsg(msgEl, 'Added.', false);
      load();
    } catch (err) {
      showFormMsg(msgEl, err.message, true);
    }
  });
}

wireEntryForms();
load();
setInterval(load, POLL_MS);
