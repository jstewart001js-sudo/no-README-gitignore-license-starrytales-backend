const API_BASE = window.location.origin;
const token = localStorage.getItem('starrytales_token');

if (!token) {
  window.location.href = 'login.html';
}

const THEME_LABELS = {
  adventure: 'Brave Adventure',
  fantasy: 'Fantasy Kingdom',
  space: 'Outer Space',
  underwater: 'Underwater World',
  animals: 'Animal Friends',
  fairytale: 'Classic Fairy Tale',
};

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function loadChildren() {
  const res = await fetch(`${API_BASE}/api/children`, { headers: authHeaders() });
  if (res.status === 401) {
    localStorage.removeItem('starrytales_token');
    window.location.href = 'login.html';
    return;
  }
  const children = await res.json();
  renderChildren(children);
}

function renderChildren(children) {
  const container = document.getElementById('childrenList');
  container.innerHTML = '';

  if (children.length === 0) {
    container.innerHTML = '<p class="sub">No children added yet — add one above to start receiving stories.</p>';
    return;
  }

  children.forEach((child) => {
    const row = document.createElement('div');
    row.className = 'child-row';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(child.name)}</strong>
        <div class="meta">${THEME_LABELS[child.story_theme] || child.story_theme} · <span class="pill">${child.active ? 'Active' : 'Paused'}</span></div>
      </div>
      <div class="row-actions">
        <select data-child-id="${child.id}" class="theme-select">
          ${Object.entries(THEME_LABELS)
            .map(([val, label]) => `<option value="${val}" ${val === child.story_theme ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
        <button data-child-id="${child.id}" data-active="${child.active}" class="toggle-active secondary">
          ${child.active ? 'Pause' : 'Resume'}
        </button>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('.theme-select').forEach((select) => {
    select.addEventListener('change', async (e) => {
      await updateChild(e.target.dataset.childId, { storyTheme: e.target.value });
    });
  });

  container.querySelectorAll('.toggle-active').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const isActive = e.target.dataset.active === 'true';
      await updateChild(e.target.dataset.childId, { active: !isActive });
      loadChildren();
    });
  });
}

async function updateChild(childId, updates) {
  await fetch(`${API_BASE}/api/children/${childId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Add child form
document.getElementById('addChildForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('addChildMsg');
  msg.className = 'msg';

  const name = document.getElementById('childName').value.trim();
  const storyTheme = document.getElementById('storyTheme').value;

  const res = await fetch(`${API_BASE}/api/children`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, storyTheme }),
  });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = data.error || 'Could not add child.';
    msg.classList.add('show', 'error');
    return;
  }

  msg.textContent = `${name} added! Their first story will arrive at 6:30 PM once your subscription is active.`;
  msg.classList.add('show', 'success');
  document.getElementById('addChildForm').reset();
  loadChildren();
});

// Billing
document.getElementById('startTrialBtn').addEventListener('click', async () => {
  const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
});

document.getElementById('manageBillingBtn').addEventListener('click', async () => {
  const res = await fetch(`${API_BASE}/api/stripe/create-portal-session`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
  else alert('Start a subscription first, then billing management will be available here.');
});

document.getElementById('logoutLink').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem('starrytales_token');
  window.location.href = 'login.html';
});

loadChildren();
