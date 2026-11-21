// ============================================================
//  storeApprovals.js — Admin approves/rejects new store owners
//
//  Reads `storeApplications` where status == 'pending'.
//  On Approve:
//    - storeApplications.status = 'approved'
//    - storeApplications.approvalStage = 'access_approved'
//    - users/{uid}.approved = true
//  On Reject:
//    - storeApplications.status = 'rejected'
//    - users/{uid}.rejectionReason = reason
// ============================================================

import {
  db,
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from '../../js/firebase-config.js';
import {
  showToast, showLoading, formatDateTime, openModal, closeModal
} from './utils.js';

const adminContent = document.getElementById('adminContent');
let unsubscribe = null;

let currentFilter = 'pending';
let currentSearch = '';
let cachedApps = [];

window.loadStoreApprovals = loadStoreApprovals;
window.viewStoreApplication = viewStoreApplication;
window.approveStoreApplication = approveStoreApplication;
window.rejectStoreApplication = rejectStoreApplication;
window.setStoreApprovalsFilter = setStoreApprovalsFilter;
window.searchStoreApprovals = searchStoreApprovals;

// ============================================================
//  LOAD
// ============================================================
export function loadStoreApprovals() {
  showLoading('Loading store applications...');

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const ref = collection(db, 'storeApplications');
  const q = query(ref, orderBy('createdAt', 'desc'));

  unsubscribe = onSnapshot(q, (snapshot) => {
    cachedApps = [];
    snapshot.forEach(d => cachedApps.push({ id: d.id, ...d.data() }));

    const pendingCount = cachedApps.filter(r => (r.status || 'pending') === 'pending').length;
    const badge = document.getElementById('storeApprovalBadge');
    if (badge) badge.textContent = pendingCount;

    render();
  }, (error) => {
    console.error('Error loading store applications:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading store applications.</p>`;
  });
}

// ============================================================
//  RENDER
// ============================================================
function render() {
  const all = cachedApps;

  const filtered = currentFilter === 'all'
    ? all
    : all.filter(r => (r.status || 'pending') === currentFilter);

  const term = currentSearch.trim().toLowerCase();
  const searched = term
    ? filtered.filter(r =>
        (r.storeName || '').toLowerCase().includes(term) ||
        (r.area || '').toLowerCase().includes(term) ||
        (r.ownerName || '').toLowerCase().includes(term) ||
        (r.email || '').toLowerCase().includes(term)
      )
    : filtered;

  const pending = all.filter(r => (r.status || 'pending') === 'pending');
  const approved = all.filter(r => r.status === 'approved');
  const rejected = all.filter(r => r.status === 'rejected');

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>Store Owner Applications</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <div style="position:relative;min-width:220px;flex:1;">
          <i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.85rem;pointer-events:none;"></i>
          <input
            type="text"
            id="storeApprovalSearch"
            placeholder="Search store, area, owner or email…"
            autocomplete="off"
            value="${escapeAttr(currentSearch)}"
            style="width:100%;padding:10px 14px 10px 36px;border:1.5px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;font-size:0.85rem;min-height:44px;box-sizing:border-box;"
          />
        </div>
        <select id="storeApprovalFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
          <option value="pending"  ${currentFilter === 'pending'  ? 'selected' : ''}>Pending only</option>
          <option value="approved" ${currentFilter === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="rejected" ${currentFilter === 'rejected' ? 'selected' : ''}>Rejected</option>
          <option value="all"      ${currentFilter === 'all'      ? 'selected' : ''}>All</option>
        </select>
      </div>
    </div>

    <div class="stats-grid compact" style="margin-bottom:1.2rem;">
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-store"></i></div>
        <div class="stat-number">${all.length}</div>
        <div class="stat-label">Total applications</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--orange);"><i class="fas fa-hourglass-half"></i></div>
        <div class="stat-number">${pending.length}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--green);"><i class="fas fa-check-circle"></i></div>
        <div class="stat-number">${approved.length}</div>
        <div class="stat-label">Approved</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--red);"><i class="fas fa-times-circle"></i></div>
        <div class="stat-number">${rejected.length}</div>
        <div class="stat-label">Rejected</div>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Store Name</th>
            <th>Area</th>
            <th>Owner</th>
            <th>Email</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (searched.length === 0) {
    const msg = term
      ? `No applications match "${escapeHtml(currentSearch)}".`
      : currentFilter === 'pending'
        ? 'No pending store applications.'
        : 'No applications match this filter.';
    html += `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">${msg}</td></tr>`;
  } else {
    searched.forEach(r => {
      const id = r.id;
      const storeName = r.storeName || '(no name)';
      const area = r.area || '—';
      const ownerName = r.ownerName || '—';
      const email = r.email || '—';
      const status = r.status || 'pending';
      const dateStr = formatDateTime(r.createdAt);

      const statusClass = status === 'approved' ? 'status-confirmed'
                        : status === 'rejected' ? 'status-rejected'
                        : 'status-packing';
      const statusLabel = status === 'approved' ? '✅ Approved'
                        : status === 'rejected' ? '❌ Rejected'
                        : '⏳ Pending';

      let actions = '';
      if (status === 'pending') {
        actions += `
          <button class="btn-sm btn-approve" onclick="approveStoreApplication('${id}')" title="Approve">
            <i class="fas fa-check"></i> Approve
          </button>
          <button class="btn-sm btn-reject" onclick="rejectStoreApplication('${id}')" title="Reject">
            <i class="fas fa-times"></i> Reject
          </button>
        `;
      }

      actions += `
        <button class="btn-sm btn-view" onclick="viewStoreApplication('${id}')" style="margin-left:4px;" title="View details">
          <i class="fas fa-eye"></i>
        </button>
      `;

      html += `
        <tr>
          <td style="font-size:0.8rem;white-space:nowrap;">${dateStr}</td>
          <td><strong>${escapeHtml(storeName)}</strong></td>
          <td>${escapeHtml(area)}</td>
          <td>${escapeHtml(ownerName)}</td>
          <td style="font-size:0.8rem;">${escapeHtml(email)}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td style="white-space:nowrap;">${actions}</td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div>`;
  adminContent.innerHTML = html;

  document.getElementById('storeApprovalFilter')?.addEventListener('change', (e) => {
    setStoreApprovalsFilter(e.target.value);
  });

  const searchEl = document.getElementById('storeApprovalSearch');
  if (searchEl) {
    let debounce = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchStoreApprovals(searchEl.value);
      }, 180);
    });
    if (currentSearch) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  }
}

// ============================================================
//  FILTER / SEARCH
// ============================================================
function setStoreApprovalsFilter(filter) {
  currentFilter = filter || 'pending';
  render();
}

function searchStoreApprovals(term) {
  currentSearch = term || '';
  render();
}

// ============================================================
//  APPROVE
// ============================================================
async function approveStoreApplication(id) {
  if (!confirm('Approve this store owner?\n\nThis will:\n• Mark their application as approved\n• Grant them access to the store portal dashboard\n• Make their store available in the manager signup list')) return;

  try {
    const appSnap = await getDoc(doc(db, 'storeApplications', id));
    if (!appSnap.exists()) {
      showToast('Application not found.');
      return;
    }
    const app = appSnap.data();
    if (!app.uid) {
      showToast('Application has no linked user. Cannot approve.');
      return;
    }

    // 1. Approve the application
    await updateDoc(doc(db, 'storeApplications', id), {
      status: 'approved',
      approvalStage: 'access_approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: 'admin',
      updatedAt: serverTimestamp()
    });

    // 2. Approve the user
    await updateDoc(doc(db, 'users', app.uid), {
      approved: true,
      updatedAt: serverTimestamp()
    });

    // 3. Add to storeDirectory so managers can find them
    await setDoc(doc(db, 'storeDirectory', app.uid), {
      uid: app.uid,
      storeName: app.storeName || '',
      area: app.area || '',
      createdAt: serverTimestamp()
    });

    showToast('✅ Store owner approved.');
  } catch (err) {
    console.error('approveStoreApplication error:', err);
    showToast('Failed to approve: ' + (err?.message || ''));
  }
}

// ============================================================
//  REJECT
// ============================================================
async function rejectStoreApplication(id) {
  const reason = prompt('Rejection reason (will be visible to the owner when they log in):');
  if (reason === null) return; // Cancel

  try {
    const appSnap = await getDoc(doc(db, 'storeApplications', id));
    if (!appSnap.exists()) {
      showToast('Application not found.');
      return;
    }
    const app = appSnap.data();
    if (!app.uid) {
      showToast('Application has no linked user. Cannot reject.');
      return;
    }

    await updateDoc(doc(db, 'storeApplications', id), {
      status: 'rejected',
      rejectionReason: reason || 'No reason provided',
      reviewedAt: serverTimestamp(),
      reviewedBy: 'admin',
      updatedAt: serverTimestamp()
    });

    await updateDoc(doc(db, 'users', app.uid), {
      approved: false,
      rejectionReason: reason || 'No reason provided',
      updatedAt: serverTimestamp()
    });

    showToast('Application rejected.');
  } catch (err) {
    console.error('rejectStoreApplication error:', err);
    showToast('Failed to reject: ' + (err?.message || ''));
  }
}

// ============================================================
//  VIEW DETAILS
// ============================================================
async function viewStoreApplication(id) {
  try {
    const snap = await getDoc(doc(db, 'storeApplications', id));
    if (!snap.exists()) {
      showToast('Application not found.');
      return;
    }
    const r = snap.data();
    const status = r.status || 'pending';
    const statusClass = status === 'approved' ? 'status-confirmed'
                      : status === 'rejected' ? 'status-rejected'
                      : 'status-packing';
    const statusLabel = status === 'approved' ? '✅ Approved'
                      : status === 'rejected' ? '❌ Rejected'
                      : '⏳ Pending';

    openModal(`
      <div class="modal-content" style="max-width:560px;">
        <div class="modal-header">
          <h3><i class="fas fa-store" style="color:var(--orange);"></i> Store Application</h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>Store Name:</strong> ${escapeHtml(r.storeName || '—')}</p>
          <p><strong>Area:</strong> ${escapeHtml(r.area || '—')}</p>
          <p><strong>Owner Name:</strong> ${escapeHtml(r.ownerName || '—')}</p>
          <p><strong>Email:</strong> ${escapeHtml(r.email || '—')}</p>
          <p><strong>Phone:</strong> ${escapeHtml(r.phone || '—')}</p>
          <p><strong>Status:</strong> <span class="status-badge ${statusClass}">${statusLabel}</span></p>
          <p><strong>Applied:</strong> ${formatDateTime(r.createdAt)}</p>
          ${r.reviewedAt ? `<p><strong>Reviewed:</strong> ${formatDateTime(r.reviewedAt)}</p>` : ''}
          ${r.rejectionReason ? `<p><strong>Rejection Reason:</strong> ${escapeHtml(r.rejectionReason)}</p>` : ''}
          ${r.uid ? `<p style="font-size:0.72rem;color:var(--text-muted);">User ID: ${escapeHtml(r.uid)}</p>` : ''}
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:6px;">
          <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Close</button>
          ${status === 'pending' ? `
            <button class="btn-sm btn-approve" onclick="closeModal(this.closest('.admin-modal'));approveStoreApplication('${id}')" style="background:#28a745;color:#fff;">
              <i class="fas fa-check"></i> Approve
            </button>
            <button class="btn-sm btn-reject" onclick="closeModal(this.closest('.admin-modal'));rejectStoreApplication('${id}')">
              <i class="fas fa-times"></i> Reject
            </button>
          ` : ''}
        </div>
      </div>
    `);
  } catch (err) {
    console.error('viewStoreApplication error:', err);
    showToast('Error loading application details.');
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