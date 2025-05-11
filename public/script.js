// ----- Global state -----
let creditors = [];
let currentCreditorId = null;

// ----- DOM elements -----
const currentDateEl     = document.getElementById('current-date');
const nameInput         = document.getElementById('name');
const nameErrorEl       = document.getElementById('name-error');
const searchInput       = document.getElementById('searchInput');
const creditorsTbody    = document.getElementById('creditors-container');
const todayPayeesList   = document.getElementById('today-payees');
const payeeCountEl      = document.getElementById('payee-count');
const calendarModal     = document.getElementById('calendarModal');
const modalDatePicker   = document.getElementById('modalDatePicker');
const historyPanel      = document.getElementById('historyPanel');
const panelOverlay      = document.getElementById('panelOverlay');
const historyContent    = document.getElementById('historyContent');
const historyCredNameEl = document.getElementById('history-creditor-name');

// ----- Initialization -----
document.addEventListener('DOMContentLoaded', async () => {
  currentDateEl.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  searchInput.addEventListener('input', onSearchInput);

  await fetchCreditors();
  renderAll();
});

// ----- API calls (updated URLs) -----
async function fetchCreditors() {
  const res = await fetch('/api/creditors');
  creditors = await res.json();
}

async function createCreditor(payload) {
  const res = await fetch('/api/creditors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function updateCreditor(id, payload) {
  const res = await fetch(`/api/creditors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function deleteCreditorApi(id) {
  await fetch(`/api/creditors/${id}`, {
    method: 'DELETE'
  });
}

// ----- Helpers -----
function getNextTuesday() {
  const date = new Date();
  date.setDate(date.getDate() + ((2 - date.getDay() + 7) % 7 || 7));
  return date.toISOString().split('T')[0];
}

function isNameDuplicate(name) {
  return creditors.some(c => c.name.toUpperCase() === name.toUpperCase());
}

// ----- Rendering -----
function renderAll() {
  renderCreditors();
  renderTodaysPayees();
}

function renderCreditors(list = creditors) {
  const unpaid = list.filter(c => c.status !== 'paid')
    .sort((a, b) => new Date(a.followUp || 0) - new Date(b.followUp || 0));
  const paid = list.filter(c => c.status === 'paid')
    .sort((a, b) => new Date(a.followUp || 0) - new Date(b.followUp || 0));
  const sorted = [...unpaid, ...paid];

  creditorsTbody.innerHTML = sorted.map(c => `
    <tr>
      <td class="name-column clickable" onclick="showHistoryPanel('${c._id}')">
        ${c.name}
        ${c.status === 'overdue'
          ? '<span class="status-indicator"><div class="status-dot overdue"></div> OVERDUE</span>'
          : ''}
      </td>
      <td>${new Date(c.lastVisit).toLocaleDateString()}</td>
      <td>${c.followUp ? new Date(c.followUp).toLocaleDateString() : '-'}</td>
      <td>
        <div class="status-indicator">
          <div class="status-dot ${c.status}"></div>
          ${c.status.toUpperCase()}
        </div>
      </td>
      <td class="actions-cell">
        <button class="btn-success" onclick="markPaid('${c._id}')">💵</button>
        <button class="btn-primary" onclick="showCalendar('${c._id}')">📅</button>
      </td>
    </tr>
  `).join('');

  if (sorted.length === 0) {
    creditorsTbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center;padding:2rem;">
        No creditors found
      </td></tr>
    `;
  }
}

function renderTodaysPayees() {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  const todays = creditors.filter(c => {
    if (!c.followUp || c.status !== 'pending') return false;
    const followUpDate = new Date(c.followUp).toLocaleDateString('en-CA');
    return followUpDate === today;
  });

  todayPayeesList.innerHTML = todays.map(c => `
    <div class="payee-item">
      <div>
        <div class="payee-name">${c.name}</div>
        </div>
      <div class="text-muted">
        Last visited: ${new Date(c.followUp).toLocaleDateString()}
      </div>
    </div>
  `).join('');

  payeeCountEl.textContent = todays.length;
}

// ----- Actions -----
async function addCreditor() {
  nameErrorEl.textContent = '';
  const name = nameInput.value.trim().toUpperCase();
  if (!name) {
    nameErrorEl.textContent = 'Please enter a creditor name';
    return;
  }
  if (isNameDuplicate(name)) {
    nameErrorEl.textContent = 'This creditor already exists!';
    return;
  }
  const newCred = await createCreditor({ name });
  creditors.push(newCred);
  renderAll();
  nameInput.value = '';
}

async function markPaid(id) {
  const nextTue = getNextTuesday();
  const entry = {
    date: new Date().toISOString(),
    action: 'PAYMENT RECEIVED',
    details: `Marked as paid. Next follow-up: ${nextTue}`,
    amount: null
  };
  const updated = await updateCreditor(id, {
    status: 'paid',
    lastVisit: new Date().toISOString(),
    followUp: nextTue,
    historyEntry: entry
  });
  creditors = creditors.map(c => c._id === updated._id ? updated : c);
  renderAll();
}

function showCalendar(id) {
  currentCreditorId = id;
  modalDatePicker.min = new Date().toISOString().split('T')[0];
  modalDatePicker.value = '';
  calendarModal.style.display = 'flex';
}

async function saveReschedule() {
  if (!modalDatePicker.value) {
    alert('Please select a follow-up date');
    return;
  }
  const entry = {
    date: new Date().toISOString(),
    action: 'RESCHEDULED',
    details: `New follow-up date: ${modalDatePicker.value}`,
    amount: null
  };
  const updated = await updateCreditor(currentCreditorId, {
    status: 'pending',
    lastVisit: new Date().toISOString(),
    followUp: modalDatePicker.value,
    historyEntry: entry
  });
  creditors = creditors.map(c => c._id === updated._id ? updated : c);
  calendarModal.style.display = 'none';
  renderAll();
}

function closeCalendar() {
  calendarModal.style.display = 'none';
  currentCreditorId = null;
}

function onSearchInput(e) {
  const term = e.target.value.trim().toUpperCase();
  const filtered = creditors.filter(c =>
    c.name.toUpperCase().includes(term) ||
    c.status.toUpperCase().includes(term) ||
    (c.lastVisit && c.lastVisit.includes(term)) ||
    (c.followUp && c.followUp.includes(term))
  );
  renderCreditors(filtered);
}

async function showHistoryPanel(id) {
  currentCreditorId = id;
  const cred = creditors.find(c => c._id === id);
  historyCredNameEl.textContent = cred.name;
  historyContent.innerHTML = cred.history.slice().reverse().map(entry => `
    <div class="history-item">
      <div class="history-date">
        ${new Date(entry.date).toLocaleDateString()}
        <span class="history-time">
          ${new Date(entry.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div class="history-action">
        <span class="history-status ${entry.action.toLowerCase().replace(' ', '-')}">
          ${entry.action}
        </span>
        <div class="history-details">${entry.details}</div>
        ${entry.amount ? `<div class="history-amount">$${entry.amount.toFixed(2)}</div>` : ''}
      </div>
    </div>
  `).join('');
  historyPanel.classList.add('active');
  panelOverlay.style.display = 'block';
}

async function deleteCreditor() {
  if (!currentCreditorId) return;
  if (confirm('Are you sure you want to delete this creditor?')) {
    await deleteCreditorApi(currentCreditorId);
    creditors = creditors.filter(c => c._id !== currentCreditorId);
    closeHistoryPanel();
    renderAll();
  }
}

function closeHistoryPanel() {
  currentCreditorId = null;
  historyPanel.classList.remove('active');
  panelOverlay.style.display = 'none';
}

window.addEventListener('click', e => {
  if (e.target === calendarModal) closeCalendar();
  if (e.target === panelOverlay) closeHistoryPanel();
});
