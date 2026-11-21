// ============================================================
//  storeRequests.js — Admin view of customer store requests
//
//  Customers submit requests from the homepage and stores page
//  ("Can't find your store?"). Each doc is written by the public
//  site (signed in or not) to the `storeRequests` collection:
//
//    storeName      string   — the store they want
//    location       string   — area / suburb
//    name           string   — customer's name (mandatory)
//    contact        string   — customer's phone (mandatory, >=9 digits)
//    customerId     string|null
//    customerPhone  string
//    status         'pending' | 'added' | 'dismissed'
//    createdAt      Timestamp
//
//  Admin actions:
//    Mark Added   → status: 'added'      (store is now on Ghost Shopper)
//    Dismiss      → status: 'dismissed'  (no action taken)
//    Delete       → hard delete (confirm-guarded)
//    WhatsApp     → opens wa.me/{contact} with a pre-filled reply
// ============================================================

import {
  db,
  collection, query, orderBy, onSnapshot,
  doc, getDoc, updateDoc, deleteDoc, serverTimestamp
} from '../../js/firebase-config.js';
import {
  showToast, showLoading, formatDateTime, openModal, closeModal
} from './utils.js';

const adminContent = document.getElementById('adminContent');
let storeRequestsUnsubscribe = null;

// Module-level state so filter + search survive rerenders
let currentFilter = 'pending';       // 'pending' | 'added' | 'dismissed' | 'all'
let currentSearch = '';
let cachedRequests = [];

window.loadStoreRequests = loadStoreRequests;
window.viewStoreRequest = viewStoreRequest;
window.markStoreRequestAdded = markStoreRequestAdded;
window.dismissStoreRequest = dismissStoreRequest;
window.deleteStoreRequest = deleteStoreRequest;
window.setStoreRequestFilter = setStoreRequestFilter;
window.searchStoreRequests = searchStoreRequests;

// ============================================================
//  LOAD
// ============================================================
export function loadStoreRequests() {
  showLoading('Loading store requests...');

  if (storeRequestsUnsubscribe) {
    storeRequestsUnsubscribe();
    storeRequestsUnsubscribe = null;
  }

  const ref = collection(db, 'storeRequests');
  const q = query(ref, orderBy('createdAt', 'desc'));

  storeRequestsUnsubscribe = onSnapshot(q, (snapshot) => {
    cachedRequests = [];
    snapshot.forEach(d => cachedRequests.push({ id: d.id, ...d.data() }));

    // Badge — pending count
    const pendingCount = cachedRequests.filter(r => (r.status || 'pending') === 'pending').length;
    const badge = document.getElementById('storeRequestBadge');
    if (badge) badge.textContent = pendingCount;

    renderRequests();
  }, (error) => {
    console.error('Error loading store requests:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading store requests.</p>`;
  });
}

// ============================================================
//  RENDER
// ============================================================
function renderRequests() {
  const all = cachedRequests;

  const filtered = currentFilter === 'all'
    ? all
    : all.filter(r => (r.status || 'pending') === currentFilter);

  const term = currentSearch.trim().toLowerCase();
  const searched = term
    ? filtered.filter(r =>
        (r.storeName || '').toLowerCase().includes(term) ||
        (r.location || '').toLowerCase().includes(term) ||
        (r.name || '').toLowerCase().includes(term) ||
        (r.contact || '').toLowerCase().includes(term)
      )
    : filtered;

  // ---- Stats ----
  const pending = all.filter(r => (r.status || 'pending') === 'pending');
  const now = new Date();
  const thisMonth = all.filter(r => {
    if (!r.createdAt) return false;
    const d = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const addedThisMonth = thisMonth.filter(r => r.status === 'added');

  // Top requested store this month
  const storeCounts = new Map();
  thisMonth.forEach(r => {
    const name = (r.storeName || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!storeCounts.has(key)) storeCounts.set(key, { name, count: 0 });
    storeCounts.get(key).count++;
  });
  let topStore = '—';
  let topStoreCount = 0;
  storeCounts.forEach(({ name, count }) => {
    if (count > topStoreCount) { topStore = name; topStoreCount = count; }
  });

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>Store Requests</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <div style="position:relative;min-width:220px;flex:1;">
          <i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.85rem;pointer-events:none;"></i>
          <input
            type="text"
            id="storeRequestSearch"
            placeholder="Search store, area, name or phone…"
            autocomplete="off"
            value="${escapeAttr(currentSearch)}"
            style="width:100%;padding:10px 14px 10px 36px;border:1.5px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;font-size:0.85rem;min-height:44px;box-sizing:border-box;"
          />
        </div>
        <select id="storeRequestFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
          <option value="pending"   ${currentFilter === 'pending'   ? 'selected' : ''}>Pending only</option>
          <option value="added"     ${currentFilter === 'added'     ? 'selected' : ''}>Added</option>
          <option value="dismissed" ${currentFilter === 'dismissed' ? 'selected' : ''}>Dismissed</option>
          <option value="all"       ${currentFilter === 'all'       ? 'selected' : ''}>All</option>
        </select>
      </div>
    </div>

    <div class="stats-grid compact" style="margin-bottom:1.2rem;">
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-store"></i></div>
        <div class="stat-number">${all.length}</div>
        <div class="stat-label">Total requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--orange);"><i class="fas fa-hourglass-half"></i></div>
        <div class="stat-number">${pending.length}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--green);"><i class="fas fa-check-circle"></i></div>
        <div class="stat-number">${addedThisMonth.length}</div>
        <div class="stat-label">Added this month</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--blue,#3B82F6);"><i class="fas fa-fire"></i></div>
        <div class="stat-number" style="font-size:1rem;line-height:1.3;">${escapeHtml(topStore)}</div>
        <div class="stat-label">Top request this month${topStoreCount ? ` (${topStoreCount})` : ''}</div>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Store wanted</th>
            <th>Area</th>
            <th>Requested by</th>
            <th>Contact</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (searched.length === 0) {
    const msg = term
      ? `No requests match "${escapeHtml(currentSearch)}".`
      : currentFilter === 'pending'
        ? 'No pending store requests.'
        : 'No requests match this filter.';
    html += `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">${msg}</td></tr>`;
  } else {
    searched.forEach(r => {
      const id = r.id;
      const storeName = r.storeName || '(no name)';
      const location = r.location || '—';
      const name = r.name || '—';
      const contact = r.contact || '—';
      const status = r.status || 'pending';
      const dateStr = formatDateTime(r.createdAt);

      const statusClass = status === 'added' ? 'status-confirmed'
                        : status === 'dismissed' ? 'status-pending'
                        : 'status-packing';
      const statusLabel = status === 'added' ? '✅ Added'
                        : status === 'dismissed' ? '❌ Dismissed'
                        : '⏳ Pending';

      const phoneDigits = String(contact).replace(/\D/g, '');
      const waNumber = phoneDigits.length >= 9 ? `27${phoneDigits.slice(-9)}` : '';
      const waText = encodeURIComponent(
        `Hi ${name}! Thanks for requesting "${storeName}". ` +
        `Good news — we've added it to Ghost Shopper. Come check it out!`
      );
      const waLink = waNumber
        ? `https://wa.me/${waNumber}?text=${waText}`
        : `https://wa.me/?text=${waText}`;

      let actions = '';
      if (status === 'pending') {
        actions += `
          <button class="btn-sm btn-approve" onclick="markStoreRequestAdded('${id}')" title="Mark as added">
            <i class="fas fa-check"></i> Added
          </button>
          <button class="btn-sm btn-reject" onclick="dismissStoreRequest('${id}')" title="Dismiss">
            <i class="fas fa-times"></i> Dismiss
          </button>
        `;
      }

      if (phoneDigits) {
        actions += `
          <a href="${waLink}" target="_blank" rel="noopener" class="btn-sm"
             style="background:#25D366;color:#fff;text-decoration:none;margin-left:4px;"
             title="Reply on WhatsApp">
            <i class="fab fa-whatsapp"></i>
          </a>
        `;
      }

      actions += `
        <button class="btn-sm btn-view" onclick="viewStoreRequest('${id}')" style="margin-left:4px;" title="View details">
          <i class="fas fa-eye"></i>
        </button>
      `;

      html += `
        <tr>
          <td style="font-size:0.8rem;white-space:nowrap;">${dateStr}</td>
          <td><strong>${escapeHtml(storeName)}</strong></td>
          <td>${escapeHtml(location)}</td>
          <td>${escapeHtml(name)}</td>
          <td style="font-size:0.8rem;">${escapeHtml(contact)}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td style="white-space:nowrap;">${actions}</td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div>`;
  adminContent.innerHTML = html;

  // ---- Wire controls ----
  document.getElementById('storeRequestFilter')?.addEventListener('change', (e) => {
    setStoreRequestFilter(e.target.value);
  });

  const searchEl = document.getElementById('storeRequestSearch');
  if (searchEl) {
    let debounce = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchStoreRequests(searchEl.value);
      }, 180);
    });
    if (currentSearch) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  }
}

// ============================================================
//  FILTER + SEARCH
// ============================================================
function setStoreRequestFilter(filter) {
  currentFilter = filter || 'pending';
  renderRequests();
}

function searchStoreRequests(term) {
  currentSearch = term || '';
  renderRequests();
}

// ============================================================
//  MARK ADDED
// ============================================================
async function markStoreRequestAdded(id) {
  if (!confirm('Mark this request as added? Use this once the store is live on Ghost Shopper.')) return;

  try {
    await updateDoc(doc(db, 'storeRequests', id), {
      status: 'added',
      actionedAt: serverTimestamp(),
      actionedBy: 'admin'
    });
    showToast('✅ Marked as added.');
  } catch (err) {
    console.error('markStoreRequestAdded error:', err);
    showToast('Failed to update request.');
  }
}

// ============================================================
//  DISMISS
// ============================================================
async function dismissStoreRequest(id) {
  if (!confirm('Dismiss this request? No action will be taken.')) return;

  try {
    await updateDoc(doc(db, 'storeRequests', id), {
      status: 'dismissed',
      actionedAt: serverTimestamp(),
      actionedBy: 'admin'
    });
    showToast('Request dismissed.');
  } catch (err) {
    console.error('dismissStoreRequest error:', err);
    showToast('Failed to dismiss request.');
  }
}

// ============================================================
//  DELETE
// ============================================================
async function deleteStoreRequest(id) {
  if (!confirm('Delete this request permanently?\n\nThis cannot be undone. If you just want to remove it from the pending list, use Dismiss instead.')) return;
  if (!confirm('Are you absolutely sure? This will permanently remove the request from Firestore.')) return;

  try {
    await deleteDoc(doc(db, 'storeRequests', id));
    showToast('🗑️ Request deleted.');
  } catch (err) {
    console.error('deleteStoreRequest error:', err);
    showToast('Failed to delete request.');
  }
}

// ============================================================
//  VIEW DETAILS
// ============================================================
async function viewStoreRequest(id) {
  try {
    const snap = await getDoc(doc(db, 'storeRequests', id));
    if (!snap.exists()) {
      showToast('Request not found.');
      return;
    }
    const r = snap.data();
    const status = r.status || 'pending';
    const storeName = r.storeName || '(no name)';
    const location = r.location || '—';
    const name = r.name || '—';
    const contact = r.contact || '';
    const phoneDigits = String(contact).replace(/\D/g, '');
    const waNumber = phoneDigits.length >= 9 ? `27${phoneDigits.slice(-9)}` : '';
    const waText = encodeURIComponent(
      `Hi ${name}! Thanks for requesting "${storeName}". ` +
      `Good news — we've added it to Ghost Shopper. Come check it out!`
    );
    const waLink = waNumber
      ? `https://wa.me/${waNumber}?text=${waText}`
      : `https://wa.me/?text=${waText}`;

    const statusClass = status === 'added' ? 'status-confirmed'
                      : status === 'dismissed' ? 'status-pending'
                      : 'status-packing';
    const statusLabel = status === 'added' ? '✅ Added'
                      : status === 'dismissed' ? '❌ Dismissed'
                      : '⏳ Pending';

    openModal(`
      <div class="modal-content" style="max-width:520px;">
        <div class="modal-header">
          <h3><i class="fas fa-store" style="color:var(--orange);"></i> Store Request</h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>Store wanted:</strong> ${escapeHtml(storeName)}</p>
          <p><strong>Area:</strong> ${escapeHtml(location)}</p>
          <p><strong>Requested by:</strong> ${escapeHtml(name)}</p>
          <p><strong>Contact:</strong> ${escapeHtml(contact || '—')}</p>
          ${r.customerPhone && r.customerPhone !== contact
            ? `<p><strong>Account phone:</strong> ${escapeHtml(r.customerPhone)}</p>`
            : ''}
          <p><strong>Status:</strong> <span class="status-badge ${statusClass}">${statusLabel}</span></p>
          <p><strong>Requested:</strong> ${formatDateTime(r.createdAt)}</p>
          ${r.actionedAt ? `<p><strong>Actioned:</strong> ${formatDateTime(r.actionedAt)}</p>` : ''}
          ${r.customerId ? `<p style="font-size:0.72rem;color:var(--text-muted);">Customer ID: ${escapeHtml(r.customerId)}</p>` : ''}

          <hr style="margin:14px 0;border:none;border-top:1px solid var(--border);">
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            ${phoneDigits ? `
              <a href="tel:${escapeAttr(contact)}" class="btn-secondary">
                <i class="fas fa-phone"></i> Call
              </a>
            ` : ''}
            <a href="${waLink}" target="_blank" rel="noopener" class="btn-secondary" style="background:#25D366;color:#fff;border-color:#25D366;">
              <i class="fab fa-whatsapp"></i> Reply on WhatsApp
            </a>
          </div>
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:6px;">
          <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Close</button>
          ${status === 'pending' ? `
            <button class="btn-sm btn-approve" onclick="closeModal(this.closest('.admin-modal'));markStoreRequestAdded('${id}')" style="background:#28a745;color:#fff;">
              <i class="fas fa-check"></i> Mark Added
            </button>
            <button class="btn-sm btn-reject" onclick="closeModal(this.closest('.admin-modal'));dismissStoreRequest('${id}')">
              <i class="fas fa-times"></i> Dismiss
            </button>
          ` : ''}
          <button class="btn-sm" onclick="closeModal(this.closest('.admin-modal'));deleteStoreRequest('${id}')" style="background:var(--red);color:#fff;">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    `);
  } catch (err) {
    console.error('viewStoreRequest error:', err);
    showToast('Error loading request details.');
  }
}

// ============================================================
//  HELPERS
// ============================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }