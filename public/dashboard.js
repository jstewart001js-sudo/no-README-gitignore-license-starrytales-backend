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
    const wrapper = document.createElement('div');
    wrapper.className = 'child-block';

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
        <button data-child-id="${child.id}" class="view-stories secondary">View stories</button>
      </div>
    `;
    wrapper.appendChild(row);

    const storyList = document.createElement('div');
    storyList.className = 'story-list';
    storyList.id = `stories-${child.id}`;
    storyList.hidden = true;
    wrapper.appendChild(storyList);

    container.appendChild(wrapper);
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

  container.querySelectorAll('.view-stories').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const childId = e.target.dataset.childId;
      const listEl = document.getElementById(`stories-${childId}`);
      const wasHidden = listEl.hidden;
      listEl.hidden = !wasHidden;
      e.target.textContent = wasHidden ? 'Hide stories' : 'View stories';
      if (wasHidden && !listEl.dataset.loaded) {
        await loadStories(childId, listEl);
        listEl.dataset.loaded = 'true';
      }
    });
  });
}

async function loadStories(childId, container) {
  container.innerHTML = '<p class="story-empty">Loading stories...</p>';

  const res = await fetch(`${API_BASE}/api/children/${childId}/stories`, { headers: authHeaders() });
  if (!res.ok) {
    container.innerHTML = '<p class="story-empty">Could not load stories right now.</p>';
    return;
  }

  const stories = await res.json();
  if (stories.length === 0) {
    container.innerHTML = '<p class="story-empty">No stories yet — the first one arrives at 6:30 PM once a subscription is active.</p>';
    return;
  }

  const statusInfo = {
    sent: { label: 'Sent', className: 'pill-sent' },
    failed: { label: 'Failed', className: 'pill-failed' },
    pending: { label: 'Pending', className: 'pill-pending' },
  };

  container.innerHTML = stories
    .map((story) => {
      const date = new Date(story.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const status = statusInfo[story.delivery_status] || statusInfo.pending;
      return `
        <div class="story-item">
          <div class="story-item-head">
            <div>
              <h3>${escapeHtml(story.title)}</h3>
              <span class="story-date">${date}</span>
            </div>
            <span class="pill ${status.className}">${status.label}</span>
          </div>
          <div class="story-body">${escapeHtml(story.body).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.story-item-head').forEach((head) => {
    head.addEventListener('click', () => {
      head.nextElementSibling.classList.toggle('show');
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
