// js/store-manager-requests.js — Owner approves/rejects manager requests

import {
  db, doc, updateDoc, serverTimestamp, collection, query, where, onSnapshot
} from './firebase-config.js';

let unsubscribe = null;

export function startManagerRequestsListener(ownerUid, onBadgeChange) {
  stopManagerRequestsListener();

  const q = query(
    collection(db, 'managerRequests'),
    where('storeId', '==', ownerUid),
    where('status', '==', 'pending')
  );

  unsubscribe = onSnapshot(q, (snap) => {
    const requests = [];
    snap.forEach(d => requests.push({ id: d.id, ...d.data() }));
    renderRequests(requests);
    if (typeof onBadgeChange === 'function') onBadgeChange(requests.length);
  }, (err) => {
    console.error('managerRequests listener error:', err);
  });
}

export function stopManagerRequestsListener() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

function renderRequests(requests) {
  const list = document.getElementById('managerRequestsList');
  const empty = document.getElementById('managerRequestsEmpty');
  if (!list || !empty) return;

  if (!requests.length) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = requests.map(r => `
    <div class="gs-list-item" data-request-id="${escapeAttr(r.id)}">
      <div class="gs-list-item-head">
        <div>
          <div class="gs-list-item-name">${escapeHtml(r.name || 'Manager')}</div>
          <div class="gs-list-item-email">${escapeHtml(r.email || '')}</div>
        </div>
        <span class="gs-muted" style="font-size:0.72rem;">Pending</span>
      </div>
      <div class="gs-list-item-actions">
        <button type="button" class="gs-btn gs-btn-sm gs-btn-approve" data-action="approve">
          <i class="fas fa-check"></i> Approve
        </button>
        <button type="button" class="gs-btn gs-btn-sm gs-btn-reject" data-action="reject">
          <i class="fas fa-times"></i> Reject
        </button>
      </div>
      <div class="gs-perms" data-perms hidden>
        <div style="font-size:0.82rem;font-weight:600;color:var(--navy);margin-bottom:4px;">Choose permissions:</div>
        <label class="gs-checkbox"><input type="checkbox" data-perm="canEditProducts" checked /> Edit products & prices</label>
        <label class="gs-checkbox"><input type="checkbox" data-perm="canEditFlyers" checked /> Manage flyers</label>
        <label class="gs-checkbox"><input type="checkbox" data-perm="canEditHours" checked /> Edit trading hours</label>
        <div class="gs-list-item-actions">
          <button type="button" class="gs-btn gs-btn-sm gs-btn-approve" data-action="confirm-approve">
            <i class="fas fa-check"></i> Confirm approval
          </button>
          <button type="button" class="gs-btn gs-btn-sm gs-btn-secondary" data-action="cancel-perms">Cancel</button>
        </div>
      </div>
    </div>
  `).join('');

  // Wire buttons
  list.querySelectorAll('[data-request-id]').forEach(item => {
    const requestId = item.dataset.requestId;
    const permsBox = item.querySelector('[data-perms]');
    const managerUid = requestId; // requestId == manager uid (we set it that way)

    item.querySelector('[data-action="approve"]')?.addEventListener('click', () => {
      permsBox.hidden = false;
    });
    item.querySelector('[data-action="cancel-perms"]')?.addEventListener('click', () => {
      permsBox.hidden = true;
    });
    item.querySelector('[data-action="reject"]')?.addEventListener('click', () => {
      handleReject(requestId);
    });
    item.querySelector('[data-action="confirm-approve"]')?.addEventListener('click', async () => {
      const perms = {
        canEditProducts: permsBox.querySelector('[data-perm="canEditProducts"]').checked === true,
        canEditFlyers:   permsBox.querySelector('[data-perm="canEditFlyers"]').checked === true,
        canEditHours:    permsBox.querySelector('[data-perm="canEditHours"]').checked === true,
        canSeeEarnings:  false
      };
      await handleApprove(requestId, managerUid, perms);
    });
  });
}

async function handleApprove(requestId, managerUid, permissions) {
  try {
    // 1. Update the manager's users/{uid} doc
    await updateDoc(doc(db, 'users', managerUid), {
      approved: true,
      permissions: permissions,
      suspended: false,
      rejectionReason: null,
      updatedAt: serverTimestamp()
    });

    // 2. Update the manager request
    await updateDoc(doc(db, 'managerRequests', requestId), {
      status: 'approved',
      reviewedBy: window.__gsCurrentUid || null,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showDashMessage('success', 'Manager approved.');
  } catch (err) {
    console.error('approve error:', err);
    showDashMessage('error', 'Could not approve. ' + (err?.message || ''));
  }
}

async function handleReject(requestId) {
  const reason = window.prompt('Reason for rejection (optional):') || '';
  try {
    await updateDoc(doc(db, 'managerRequests', requestId), {
      status: 'rejected',
      rejectionReason: reason,
      reviewedBy: window.__gsCurrentUid || null,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    // Also mark the user's doc as rejected so they know at login
    try {
      await updateDoc(doc(db, 'users', requestId), {
        approved: false,
        rejectionReason: reason,
        updatedAt: serverTimestamp()
      });
    } catch (_) {}

    showDashMessage('success', 'Manager request rejected.');
  } catch (err) {
    console.error('reject error:', err);
    showDashMessage('error', 'Could not reject. ' + (err?.message || ''));
  }
}

function showDashMessage(type, text) {
  const el = document.getElementById('dashMessage');
  if (!el) return;
  el.className = 'gs-message ' + type;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = 'gs-message'; }, 4000);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }