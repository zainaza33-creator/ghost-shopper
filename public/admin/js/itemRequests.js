// ============================================================
//  itemRequests.js — Admin view of customer item requests
//
//  Customers submit requests from the store page ("Can't find
//  something? Ask us to add it"). Each doc is written by the
//  public store page (signed in or not) with:
//
//    itemName   — what they want
//    note       — optional extra detail
//    contact    — their mobile number (REQUIRED on the store page)
//    notifyMe   — boolean, did they ask to be notified
//    storeName  — which store they were looking at
//    storeId    — that store's id
//    customerId — uid if signed in, null otherwise
//    customerPhone — their auth phone if signed in, '' otherwise
//    status     — 'pending' | 'added' | 'dismissed'
//    createdAt  — serverTimestamp
//
//  Admin actions:
//    Mark Added   → status: 'added'      (item is now in the store)
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
let itemRequestsUnsubscribe = null;

// Module-level state so filter + search survive rerenders
let currentFilter = 'pending';       // 'pending' | 'added' | 'dismissed' | 'all'
let currentSearch = '';
let cachedRequests = [];             // full snapshot list, newest first

window.loadItemRequests = loadItemRequests;
window.viewItemRequest = viewItemRequest;
window.markItemRequestAdded = markItemRequestAdded;
window.dismissItemRequest = dismissItemRequest;
window.deleteItemRequest = deleteItemRequest;
window.setItemRequestFilter = setItemRequestFilter;
window.searchItemRequests = searchItemRequests;

// ============================================================
//  LOAD
// ============================================================
export function loadItemRequests() {
  showLoading('Loading item requests...');

  if (itemRequestsUnsubscribe) {
    itemRequestsUnsubscribe();
    itemRequestsUnsubscribe = null;
  }

  const ref = collection(db, 'itemRequests');
  const q = query(ref, orderBy('createdAt', 'desc'));

  itemRequestsUnsubscribe = onSnapshot(q, (snapshot) => {
    cachedRequests = [];
    snapshot.forEach(d => cachedRequests.push({ id: d.id, ...d.data() }));

    // Badge — pending count
    const pendingCount = cachedRequests.filter(r => (r.status || 'pending') === 'pending').length;
    const badge = document.getElementById('itemRequestBadge');
    if (badge) badge.textContent = pendingCount;

    renderRequests();
  }, (error) => {
    console.error('Error loading item requests:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading item requests.</p>`;
  });
}

// ============================================================
//  RENDER
// ============================================================
function renderRequests() {
  const all = cachedRequests;

  // Apply filter
  const filtered = currentFilter === 'all'
    ? all
    : all.filter(r => (r.status || 'pending') === currentFilter);

  // Apply search
  const term = currentSearch.trim().toLowerCase();
  const searched = term
    ? filtered.filter(r =>
        (r.itemName || '').toLowerCase().includes(term) ||
        (r.storeName || '').toLowerCase().includes(term) ||
        (r.contact || '').toLowerCase().includes(term) ||
        (r.note || '').toLowerCase().includes(term)
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

  // Top store this month (by request count)
  const storeCounts = new Map();
  thisMonth.forEach(r => {
    const name = (r.storeName || '').trim();
    if (!name) return;
    storeCounts.set(name, (storeCounts.get(name) || 0) + 1);
  });
  let topStore = '—';
  let topStoreCount = 0;
  storeCounts.forEach((count, name) => {
    if (count > topStoreCount) { topStore = name; topStoreCount = count; }
  });

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>Item Requests</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <div style="position:relative;min-width:220px;flex:1;">
          <i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.85rem;pointer-events:none;"></i>
          <input
            type="text"
            id="itemRequestSearch"
            placeholder="Search item, store or phone…"
            autocomplete="off"
            value="${escapeAttr(currentSearch)}"
            style="width:100%;padding:10px 14px 10px 36px;border:1.5px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;font-size:0.85rem;min-height:44px;box-sizing:border-box;"
          />
        </div>
        <select id="itemRequestFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
          <option value="pending"   ${currentFilter === 'pending'   ? 'selected' : ''}>Pending only</option>
          <option value="added"     ${currentFilter === 'added'     ? 'selected' : ''}>Added</option>
          <option value="dismissed" ${currentFilter === 'dismissed' ? 'selected' : ''}>Dismissed</option>
          <option value="all"       ${currentFilter === 'all'       ? 'selected' : ''}>All</option>
        </select>
      </div>
    </div>

    <div class="stats-grid compact" style="margin-bottom:1.2rem;">
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-lightbulb"></i></div>
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
        <div class="stat-icon" style="color:var(--blue,#3B82F6);"><i class="fas fa-store"></i></div>
        <div class="stat-number" style="font-size:1rem;line-height:1.3;">${escapeHtml(topStore)}</div>
        <div class="stat-label">Top store this month${topStoreCount ? ` (${topStoreCount})` : ''}</div>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
            <th>Store</th>
            <th>Contact</th>
            <th>Note</th>
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
        ? 'No pending item requests.'
        : 'No requests match this filter.';
    html += `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">${msg}</td></tr>`;
  } else {
    searched.forEach(r => {
      const id = r.id;
      const itemName = r.itemName || '(no name)';
      const storeName = r.storeName || '—';
      const contact = r.contact || '—';
      const note = (r.note || '').trim();
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
        `Hi! Thanks for the request for "${itemName}" at ${storeName}. ` +
        `Good news — we've added it. Come check it out on Ghost Shopper!`
      );
      const waLink = waNumber
        ? `https://wa.me/${waNumber}?text=${waText}`
        : `https://wa.me/?text=${waText}`;

      const notePreview = note.length > 40
        ? escapeHtml(note.slice(0, 40)) + '…'
        : (note ? escapeHtml(note) : '<span style="color:var(--text-muted);">—</span>');

      let actions = '';
      if (status === 'pending') {
        actions += `
          <button class="btn-sm btn-approve" onclick="markItemRequestAdded('${id}')" title="Mark as added">
            <i class="fas fa-check"></i> Added
          </button>
          <button class="btn-sm btn-reject" onclick="dismissItemRequest('${id}')" title="Dismiss">
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
        <button class="btn-sm btn-view" onclick="viewItemRequest('${id}')" style="margin-left:4px;" title="View details">
          <i class="fas fa-eye"></i>
        </button>
      `;

      html += `
        <tr>
          <td style="font-size:0.8rem;white-space:nowrap;">${dateStr}</td>
          <td><strong>${escapeHtml(itemName)}</strong></td>
          <td>${escapeHtml(storeName)}</td>
          <td style="font-size:0.8rem;">${escapeHtml(contact)}</td>
          <td style="font-size:0.8rem;max-width:220px;">${notePreview}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td style="white-space:nowrap;">${actions}</td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div>`;
  adminContent.innerHTML = html;

  // ---- Wire controls ----
  document.getElementById('itemRequestFilter')?.addEventListener('change', (e) => {
    setItemRequestFilter(e.target.value);
  });

  const searchEl = document.getElementById('itemRequestSearch');
  if (searchEl) {
    let debounce = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchItemRequests(searchEl.value);
      }, 180);
    });
    // Preserve caret when we rerender the same input
    if (currentSearch) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  }
}

// ============================================================
//  FILTER + SEARCH
// ============================================================
function setItemRequestFilter(filter) {
  currentFilter = filter || 'pending';
  renderRequests();
}

function searchItemRequests(term) {
  currentSearch = term || '';
  renderRequests();
}

// ============================================================
//  MARK ADDED
// ============================================================
async function markItemRequestAdded(id) {
  if (!confirm('Mark this request as added? Use this once the item is live in the store.')) return;

  try {
    await updateDoc(doc(db, 'itemRequests', id), {
      status: 'added',
      actionedAt: serverTimestamp(),
      actionedBy: 'admin'
    });
    showToast('✅ Marked as added.');
    // onSnapshot refreshes the table automatically.
  } catch (err) {
    console.error('markItemRequestAdded error:', err);
    showToast('Failed to update request.');
  }
}

// ============================================================
//  DISMISS
// ============================================================
async function dismissItemRequest(id) {
  if (!confirm('Dismiss this request? No action will be taken.')) return;

  try {
    await updateDoc(doc(db, 'itemRequests', id), {
      status: 'dismissed',
      actionedAt: serverTimestamp(),
      actionedBy: 'admin'
    });
    showToast('Request dismissed.');
  } catch (err) {
    console.error('dismissItemRequest error:', err);
    showToast('Failed to dismiss request.');
  }
}

// ============================================================
//  DELETE (hard delete, confirm-guarded)
// ============================================================
async function deleteItemRequest(id) {
  if (!confirm('Delete this request permanently?\n\nThis cannot be undone. If you just want to remove it from the pending list, use Dismiss instead.')) return;
  if (!confirm('Are you absolutely sure? This will permanently remove the request from Firestore.')) return;

  try {
    await deleteDoc(doc(db, 'itemRequests', id));
    showToast('🗑️ Request deleted.');
    // onSnapshot refreshes the table automatically.
  } catch (err) {
    console.error('deleteItemRequest error:', err);
    showToast('Failed to delete request.');
  }
}

// ============================================================
//  VIEW DETAILS
// ============================================================
async function viewItemRequest(id) {
  try {
    const snap = await getDoc(doc(db, 'itemRequests', id));
    if (!snap.exists()) {
      showToast('Request not found.');
      return;
    }
    const r = snap.data();
    const status = r.status || 'pending';
    const itemName = r.itemName || '(no name)';
    const storeName = r.storeName || '—';
    const contact = r.contact || '';
    const phoneDigits = String(contact).replace(/\D/g, '');
    const waNumber = phoneDigits.length >= 9 ? `27${phoneDigits.slice(-9)}` : '';
    const waText = encodeURIComponent(
      `Hi! Thanks for the request for "${itemName}" at ${storeName}. ` +
      `Good news — we've added it. Come check it out on Ghost Shopper!`
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

    const modal = openModal(`
      <div class="modal-content" style="max-width:520px;">
        <div class="modal-header">
          <h3><i class="fas fa-lightbulb" style="color:var(--orange);"></i> Item Request</h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>Item:</strong> ${escapeHtml(itemName)}</p>
          <p><strong>Store:</strong> ${escapeHtml(storeName)}</p>
          <p><strong>Contact:</strong> ${escapeHtml(contact || '—')}</p>
          ${r.customerPhone && r.customerPhone !== contact
            ? `<p><strong>Account phone:</strong> ${escapeHtml(r.customerPhone)}</p>`
            : ''}
          <p><strong>Notify when added:</strong> ${r.notifyMe ? 'Yes' : 'No'}</p>
          <p><strong>Status:</strong> <span class="status-badge ${statusClass}">${statusLabel}</span></p>
          <p><strong>Requested:</strong> ${formatDateTime(r.createdAt)}</p>
          ${r.actionedAt ? `<p><strong>Actioned:</strong> ${formatDateTime(r.actionedAt)}</p>` : ''}
          ${r.note ? `<p style="margin-top:10px;"><strong>Note:</strong><br>${escapeHtml(r.note)}</p>` : ''}
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
            <button class="btn-sm btn-approve" onclick="closeModal(this.closest('.admin-modal'));markItemRequestAdded('${id}')" style="background:#28a745;color:#fff;">
              <i class="fas fa-check"></i> Mark Added
            </button>
            <button class="btn-sm btn-reject" onclick="closeModal(this.closest('.admin-modal'));dismissItemRequest('${id}')">
              <i class="fas fa-times"></i> Dismiss
            </button>
          ` : ''}
          <button class="btn-sm" onclick="closeModal(this.closest('.admin-modal'));deleteItemRequest('${id}')" style="background:var(--red);color:#fff;">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    `);
  } catch (err) {
    console.error('viewItemRequest error:', err);
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