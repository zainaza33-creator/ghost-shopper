// ============================================================
//  driverPayments.js — Admin view of driver payment requests
//  Shows pending + history of driverPayments documents.
//  Actions: Pay (calls payDriver Cloud Function), Reject.
// ============================================================

import {
  db,
  collection, query, where, orderBy, onSnapshot, doc,
  updateDoc, getDoc, serverTimestamp,
  getFunctions, httpsCallable
} from '../../js/firebase-config.js';
import {
  showToast, showLoading, formatMoney, formatDateTime, openModal, closeModal
} from './utils.js';

const adminContent = document.getElementById('adminContent');

let paymentsUnsubscribe = null;
let currentFilter = 'requested'; // 'requested' | 'paid' | 'rejected' | 'all'

window.loadDriverPayments = loadDriverPayments;
window.viewDriverPayment = viewDriverPayment;
window.payDriverPayment = payDriverPayment;
window.rejectDriverPayment = rejectDriverPayment;
window.setDriverPaymentFilter = setDriverPaymentFilter;

// ============================================================
//  LOAD DRIVER PAYMENTS
// ============================================================
export function loadDriverPayments() {
  showLoading('Loading driver payments...');

  if (paymentsUnsubscribe) {
    paymentsUnsubscribe();
    paymentsUnsubscribe = null;
  }

  const paymentsRef = collection(db, 'driverPayments');
  const q = query(paymentsRef, orderBy('requestedAt', 'desc'));

  paymentsUnsubscribe = onSnapshot(q, (snapshot) => {
    const all = [];
    snapshot.forEach(d => all.push({ id: d.id, ...d.data() }));

    // Update pending badge
    const pendingCount = all.filter(p => p.status === 'requested').length;
    const badge = document.getElementById('driverPaymentBadge');
    if (badge) badge.textContent = pendingCount;

    renderPayments(all);
  }, (error) => {
    console.error('Error loading driver payments:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading driver payments.</p>`;
  });
}

// ============================================================
//  RENDER
// ============================================================
function renderPayments(all) {
  // Apply filter
  const filtered = currentFilter === 'all'
    ? all
    : all.filter(p => (p.status || 'requested') === currentFilter);

  // Stats
  const totalPending = all.filter(p => p.status === 'requested');
  const totalPaidThisMonth = all.filter(p => {
    if (p.status !== 'paid' || !p.paidAt) return false;
    const paid = p.paidAt.toDate ? p.paidAt.toDate() : new Date(p.paidAt);
    const now = new Date();
    return paid.getMonth() === now.getMonth() && paid.getFullYear() === now.getFullYear();
  });

  const pendingAmount = totalPending.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paidAmount = totalPaidThisMonth.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>Driver Payments</h3>
      <select id="driverPaymentFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
        <option value="requested" ${currentFilter === 'requested' ? 'selected' : ''}>Pending only</option>
        <option value="paid" ${currentFilter === 'paid' ? 'selected' : ''}>Paid</option>
        <option value="rejected" ${currentFilter === 'rejected' ? 'selected' : ''}>Rejected</option>
        <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>All</option>
      </select>
    </div>

    <div class="stats-grid compact" style="margin-bottom:1.2rem;">
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-hourglass-half"></i></div>
        <div class="stat-number">${totalPending.length}</div>
        <div class="stat-label">Pending requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--orange);"><i class="fas fa-money-bill-wave"></i></div>
        <div class="stat-number">${formatMoney(pendingAmount)}</div>
        <div class="stat-label">Pending amount</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--green);"><i class="fas fa-check-circle"></i></div>
        <div class="stat-number">${totalPaidThisMonth.length}</div>
        <div class="stat-label">Paid this month</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="color:var(--green);"><i class="fas fa-wallet"></i></div>
        <div class="stat-number">${formatMoney(paidAmount)}</div>
        <div class="stat-label">Paid amount this month</div>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Driver</th>
            <th>Phone</th>
            <th>Amount</th>
            <th>Orders</th>
            <th>Status</th>
            <th>Requested</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (filtered.length === 0) {
    const msg = currentFilter === 'requested'
      ? 'No pending payment requests.'
      : 'No payments match this filter.';
    html += `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">${msg}</td></tr>`;
  } else {
    filtered.forEach(p => {
      const id = p.id;
      const name = p.driverName || 'Driver';
      const phone = p.driverPhone || 'N/A';
      const amount = Number(p.amount || 0);
      const orderCount = p.orderCount || 0;
      const status = p.status || 'requested';
      const statusClass = status === 'paid' ? 'status-confirmed'
                        : status === 'rejected' ? 'status-pending'
                        : 'status-packed';
      const statusLabel = status === 'paid' ? '✅ Paid'
                        : status === 'rejected' ? '❌ Rejected'
                        : '⏳ Pending';
      const requestedAt = formatDateTime(p.requestedAt);

      let actions = '';
      if (status === 'requested') {
        actions = `
          <button class="btn-sm btn-approve" onclick="payDriverPayment('${id}')">
            <i class="fas fa-money-bill"></i> Pay
          </button>
          <button class="btn-sm btn-reject" onclick="rejectDriverPayment('${id}')">
            <i class="fas fa-times"></i> Reject
          </button>
        `;
      } else if (status === 'paid' && p.paidAt) {
        actions = `<span style="font-size:0.72rem;color:var(--text-muted);">Paid ${formatDateTime(p.paidAt)}</span>`;
      } else if (status === 'rejected') {
        actions = `<span style="font-size:0.72rem;color:var(--text-muted);">Rejected</span>`;
      }

      html += `
        <tr>
          <td><strong>${escapeHtml(name)}</strong></td>
          <td>${escapeHtml(phone)}</td>
          <td>${formatMoney(amount)}</td>
          <td>${orderCount}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td style="font-size:0.8rem;">${requestedAt}</td>
          <td>${actions}
            <button class="btn-sm btn-view" onclick="viewDriverPayment('${id}')" style="margin-left:4px;">
              <i class="fas fa-eye"></i>
            </button>
          </td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div>`;
  adminContent.innerHTML = html;

  document.getElementById('driverPaymentFilter')?.addEventListener('change', (e) => {
    setDriverPaymentFilter(e.target.value);
  });
}

// ============================================================
//  FILTER
// ============================================================
function setDriverPaymentFilter(filter) {
  currentFilter = filter || 'requested';
  loadDriverPayments();
}

// ============================================================
//  VIEW DETAILS
// ============================================================
async function viewDriverPayment(id) {
  try {
    const snap = await getDoc(doc(db, 'driverPayments', id));
    if (!snap.exists()) {
      showToast('Payment record not found.');
      return;
    }
    const p = snap.data();
    const status = p.status || 'requested';
    const amount = Number(p.amount || 0);

    const modal = openModal(`
      <div class="modal-content" style="max-width:520px;">
        <div class="modal-header">
          <h3>Driver Payment Request</h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>Driver:</strong> ${escapeHtml(p.driverName || 'Driver')}</p>
          <p><strong>Phone:</strong> ${escapeHtml(p.driverPhone || 'N/A')}</p>
          <p><strong>Amount:</strong> ${formatMoney(amount)}</p>
          <p><strong>Orders covered:</strong> ${p.orderCount || 0}</p>
          <p><strong>Per-trip rate:</strong> ${formatMoney(p.perTripRate || 20)}</p>
          <p><strong>Status:</strong> ${status.toUpperCase()}</p>
          <p><strong>Requested:</strong> ${formatDateTime(p.requestedAt)}</p>
          ${p.paidAt ? `<p><strong>Paid:</strong> ${formatDateTime(p.paidAt)}</p>` : ''}
          ${p.rejectedAt ? `<p><strong>Rejected:</strong> ${formatDateTime(p.rejectedAt)}</p>` : ''}

          <hr style="margin:14px 0;border:none;border-top:1px solid var(--border);">
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a href="tel:${escapeHtml(p.driverPhone || '')}" class="btn-secondary">
              <i class="fas fa-phone"></i> Call driver
            </a>
            <a href="https://wa.me/${(p.driverPhone || '').replace(/\\D/g, '')}" target="_blank" rel="noopener" class="btn-secondary">
              <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
          </div>
        </div>
        <div class="modal-footer">
          ${status === 'requested' ? `
            <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Close</button>
            <button class="btn-save" onclick="closeModal(this.closest('.admin-modal')); payDriverPayment('${id}')">
              <i class="fas fa-money-bill"></i> Pay ${formatMoney(amount)}
            </button>
          ` : `
            <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Close</button>
          `}
        </div>
      </div>
    `);
  } catch (err) {
    console.error('Error loading payment:', err);
    showToast('Error loading payment details.');
  }
}

// ============================================================
//  PAY DRIVER
//  Calls the existing payDriver Cloud Function which:
//    - updates drivers/{phone}.paidEarnings
//    - adds a driverPayments audit record
//    - sends a push notification
//  Then we also mark THIS request doc as paid.
// ============================================================
async function payDriverPayment(id) {
  if (!confirm("Mark this payment as paid? This will update the driver's paid earnings.")) return;

  try {
    const snap = await getDoc(doc(db, 'driverPayments', id));
    if (!snap.exists()) {
      showToast('Payment record not found.');
      return;
    }
    const p = snap.data();
    if (p.status !== 'requested') {
      showToast('This payment is not pending.');
      return;
    }

    const driverPhone = p.driverPhone;
    const amount = Number(p.amount || 0);

    if (!driverPhone || amount <= 0) {
      showToast('Invalid payment record.');
      return;
    }

    // Call the existing payDriver Cloud Function
    const functions = getFunctions();
    const payDriverFn = httpsCallable(functions, 'payDriver');
    const result = await payDriverFn({ driverId: driverPhone, amount, requestId: id });

    if (!result.data.success) {
      showToast(result.data.message || 'Payment failed.');
      return;
    }

    // Mark this request doc as paid
    await updateDoc(doc(db, 'driverPayments', id), {
      status: 'paid',
      paidAt: serverTimestamp(),
      paidBy: 'admin'
    });

    showToast(`✅ ${formatMoney(amount)} paid to ${p.driverName || 'driver'}.`);
    loadDriverPayments();
  } catch (err) {
    console.error('payDriverPayment error:', err);
    showToast(err.message || 'Failed to process payment.');
  }
}

// ============================================================
//  REJECT DRIVER PAYMENT
// ============================================================
async function rejectDriverPayment(id) {
  if (!confirm('Reject this payment request? The driver will need to submit a new one.')) return;

  try {
    const snap = await getDoc(doc(db, 'driverPayments', id));
    if (!snap.exists()) {
      showToast('Payment record not found.');
      return;
    }
    const p = snap.data();
    if (p.status !== 'requested') {
      showToast('This payment is not pending.');
      return;
    }

    await updateDoc(doc(db, 'driverPayments', id), {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
      rejectedBy: 'admin'
    });

    showToast('Payment request rejected.');
    loadDriverPayments();
  } catch (err) {
    console.error('rejectDriverPayment error:', err);
    showToast('Failed to reject payment.');
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