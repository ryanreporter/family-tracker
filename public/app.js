const POLL_MS = 5000;

function fmtMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let features = { calories: false, exercise: false };

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

async function deleteItem(url) {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
      <div class="meta">
        ${t.person_name || 'unknown'} · ${timeAgo(t.created_at)}
        <button class="delete-btn" data-id="${t.id}">Delete</button>
      </div>
    </li>
  `).join('') || '<li class="meta">No transactions yet.</li>';
  el.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteItem(`/api/budget/transactions/${btn.dataset.id}`);
      load();
    });
  });
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
        ${p.entries.map((e) => `
          <li>
            ${e.calories} cal — ${e.description || ''}
            <div class="meta">
              ${timeAgo(e.created_at)}
              <button class="delete-entry-btn" data-id="${e.id}">Delete</button>
            </div>
          </li>
        `).join('') || '<li class="meta">Nothing logged today.</li>'}
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
  el.querySelectorAll('.delete-entry-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteItem(`/api/calories/entries/${btn.dataset.id}`);
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

function fmtDateTime(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

let archivesCache = [];
let openArchiveId = null;

function renderArchiveDetail(archive) {
  const { transactions, calorieEntries, exerciseEntries } = archive.data;
  const txHtml = transactions.map((t) => `<li>${fmtMoney(t.amount)} — ${t.bucket_name} — ${t.description || ''} <span class="meta">(${t.person_name || 'unknown'})</span></li>`).join('') || '<li class="meta">No spending.</li>';
  const calHtml = calorieEntries.map((c) => `<li>${c.calories} cal — ${c.description || ''} <span class="meta">(${c.person_name})</span></li>`).join('') || '<li class="meta">Nothing logged.</li>';
  const exHtml = exerciseEntries.map((e) => `<li>${e.description} <span class="meta">(${e.person_name})</span></li>`).join('') || '<li class="meta">No exercise logged.</li>';
  return `
    <div class="archive-detail">
      <h4>Budget (${fmtMoney(archive.total_spent)} total)</h4>
      <ul class="list">${txHtml}</ul>
      ${features.calories || calorieEntries.length ? `<h4>Calories</h4><ul class="list">${calHtml}</ul>` : ''}
      ${features.exercise || exerciseEntries.length ? `<h4>Exercise</h4><ul class="list">${exHtml}</ul>` : ''}
    </div>
  `;
}

function renderArchives(archives) {
  archivesCache = archives;
  const el = document.getElementById('archives-list');
  el.innerHTML = archives.map((a) => `
    <li>
      <button class="archive-toggle" data-id="${a.id}">${a.title}</button>
      <div class="meta">${fmtMoney(a.total_spent)} spent · archived ${fmtDateTime(a.created_at)}</div>
      <div class="archive-body" id="archive-body-${a.id}" hidden></div>
    </li>
  `).join('') || '<li class="meta">No archived weeks yet.</li>';

  el.querySelectorAll('.archive-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const bodyEl = document.getElementById(`archive-body-${id}`);
      if (openArchiveId === id) {
        bodyEl.hidden = true;
        openArchiveId = null;
        return;
      }
      if (openArchiveId != null) {
        const prevBody = document.getElementById(`archive-body-${openArchiveId}`);
        if (prevBody) prevBody.hidden = true;
      }
      openArchiveId = id;
      const res = await fetch(`/api/archives/${id}`);
      const archive = await res.json();
      bodyEl.innerHTML = renderArchiveDetail(archive);
      bodyEl.hidden = false;
    });
  });
}

async function loadArchives() {
  try {
    const res = await fetch('/api/archives');
    if (!res.ok) return;
    renderArchives(await res.json());
  } catch (err) {
    console.error('Failed to load archives', err);
  }
}

function wireResetButton() {
  document.getElementById('reset-now-btn').addEventListener('click', async () => {
    const msgEl = document.getElementById('reset-now-msg');
    if (!confirm("Archive this week's items and reset the dashboard to zero now?")) return;
    try {
      await postJson('/api/archives/reset-now', {});
      showFormMsg(msgEl, 'Reset done.', false);
      load();
      loadArchives();
    } catch (err) {
      showFormMsg(msgEl, err.message, true);
    }
  });
}

function renderUpcoming(upcoming) {
  populateSelect(
    document.getElementById('upcoming-entry-for'),
    upcoming.recipients.map((r) => ({ id: r, name: r })),
    'id',
    'name'
  );
  const el = document.getElementById('upcoming-items');
  el.innerHTML = upcoming.items.map((i) => `
    <li>
      ${fmtMoney(i.estimated_cost)} — ${escapeHtml(i.description)}
      <div class="meta">
        For ${escapeHtml(i.for_person)} · added ${fmtDateTime(i.created_at)}
        <button class="delete-upcoming-btn delete-btn" data-id="${i.id}">Delete</button>
      </div>
    </li>
  `).join('') || '<li class="meta">Nothing on the list.</li>';
  el.querySelectorAll('.delete-upcoming-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteItem(`/api/upcoming/${btn.dataset.id}`);
      load();
    });
  });
}

function populateEntryFormDropdowns(data) {
  populateSelect(document.getElementById('budget-entry-bucket'), data.budget.buckets, 'id', 'name');
  populateSelect(document.getElementById('budget-entry-person'), data.people, 'id', 'name');
  if (data.calories) populateSelect(document.getElementById('calorie-entry-person'), data.people, 'id', 'name');
  if (data.exercise) populateSelect(document.getElementById('exercise-entry-person'), data.people, 'id', 'name');
}

async function load() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const data = await res.json();
    features = data.features;
    document.getElementById('calorie-section').hidden = !features.calories;
    document.getElementById('exercise-section').hidden = !features.exercise;

    // If the user is actively typing in a bucket/limit field, rebuilding
    // those cards right now would wipe out whatever they've typed but not
    // yet saved. Skip just those cards until they click away or hit Save;
    // the rest of the page (transactions, exercise, dropdowns) still stays
    // live. Only an input/select counts as "editing" — the Save button
    // itself also lives inside .edit-row, and focus lands on it right after
    // a click, which must NOT block the immediate post-save refresh.
    const active = document.activeElement;
    const editingField =
      active && (active.tagName === 'INPUT' || active.tagName === 'SELECT') && active.closest('.edit-row');
    if (!editingField) {
      renderTopline(data.budget.topline);
      if (data.calories) renderCaloriePeople(data.calories.people);
    }

    renderTransactions(data.budget.recentTransactions);
    if (data.exercise) renderExercise(data.exercise.entries);
    renderUpcoming(data.upcoming);
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

  document.getElementById('upcoming-entry-submit').addEventListener('click', async () => {
    const msgEl = document.getElementById('upcoming-entry-msg');
    const estimated_cost = document.getElementById('upcoming-entry-cost').value;
    const description = document.getElementById('upcoming-entry-description').value;
    const for_person = document.getElementById('upcoming-entry-for').value;
    try {
      await postJson('/api/upcoming', { estimated_cost, description, for_person });
      document.getElementById('upcoming-entry-cost').value = '';
      document.getElementById('upcoming-entry-description').value = '';
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
wireResetButton();
load();
loadArchives();
setInterval(load, POLL_MS);
