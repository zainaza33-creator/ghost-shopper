// ============================================================
//  REFUNDS.JS - Refund management module
//
//  Cash-out flow:
//   - Customer (or admin on their behalf) creates a request.
//   - Admin pays the customer out-of-band (EFT, cash, etc.).
//   - Admin clicks "Mark Paid". Server-side callable DEBITS the
//     customer's wallet by the request amount. Idempotent.
//
//  Reject flow:
//   - Admin clicks "Reject". Server-side callable marks the
//     request rejected. No wallet movement.
//
//  Both transitions use Firestore transactions on the same doc,
//  so a refund can never be both rejected and paid.
// ============================================================

import {
  db,
  collection, query, orderBy, getDocs, onSnapshot,
  doc, getDoc, serverTimestamp,
  getFunctions, httpsCallable, auth
} from '../../js/firebase-config.js';
import {
  showToast, showLoading, formatMoney, formatDate, formatDateTime,
  getStatusBadge, openModal, closeModal
} from './utils.js';

const adminContent = document.getElementById('adminContent');
let refundsUnsubscribe = null;

window.loadRefunds = loadRefunds;
window.viewRefund = viewRefund;
window.markRefundPaid = markRefundPaid;
window.rejectRefund = rejectRefund;
window.openCreditNoteModal = openCreditNoteModal;

// ============================================================
//  LOAD REFUNDS
// ============================================================
export function loadRefunds() {
  showLoading('Loading refunds...');

  if (refundsUnsubscribe) refundsUnsubscribe();

  const refundsRef = collection(db, 'refundRequests');
  const q = query(refundsRef, orderBy('createdAt', 'desc'));

  refundsUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      adminContent.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem;">No refund requests found.</p>`;
      const badge = document.getElementById('refundBadge');
      if (badge) badge.textContent = '0';
      return;
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>Refund Requests</h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <select id="refundFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
          <button class="btn-primary" onclick="openCreditNoteModal()" style="font-size:0.8rem;padding:0.3rem 0.8rem;">
            <i class="fas fa-gift"></i> Issue Credit Note
          </button>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Phone</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    let hasRefunds = false;
    const filterEl = document.getElementById('refundFilter');
    const filter = filterEl?.value || 'all';

    snapshot.forEach(docSnap => {
      const refund = docSnap.data();
      const refundId = docSnap.id;
      const status = refund.status || 'pending';

      if (filter !== 'all' && status !== filter) return;

      hasRefunds = true;
      const statusHtml = getStatusBadge(status);
      const phone = refund.userPhone || 'N/A';
      const userName = refund.userName || 'Unknown';

      html += `
        <tr>
          <td><strong>${escapeHtml(userName)}</strong></td>
          <td>
            ${escapeHtml(phone)}
            <div style="display:flex;gap:0.3rem;margin-top:0.2rem;">
              <a href="tel:${escapeAttr(phone)}" class="btn-sm" style="background:#28a745;color:#fff;padding:0.1rem 0.4rem;border-radius:4px;font-size:0.6rem;text-decoration:none;">
                <i class="fas fa-phone"></i>
              </a>
              <a href="https://wa.me/${String(phone).replace(/\s/g, '')}" target="_blank" class="btn-sm" style="background:#25D366;color:#fff;padding:0.1rem 0.4rem;border-radius:4px;font-size:0.6rem;text-decoration:none;">
                <i class="fab fa-whatsapp"></i>
              </a>
            </div>
          </td>
          <td>${formatMoney(refund.amount || 0)}</td>
          <td>${statusHtml}</td>
          <td style="font-size:0.8rem;">${formatDate(refund.createdAt)}</td>
          <td>
            ${status === 'pending' ? `
              <button class="btn-sm btn-approve" onclick="markRefundPaid('${refundId}')" style="background:#28a745;color:#fff;">
                <i class="fas fa-check"></i> Mark Paid
              </button>
              <button class="btn-sm btn-reject" onclick="rejectRefund('${refundId}')">
                <i class="fas fa-times"></i> Reject
              </button>
            ` : ''}
            <button class="btn-sm btn-view" onclick="viewRefund('${refundId}')"><i class="fas fa-eye"></i></button>
          </td>
        </tr>
      `;
    });

    if (!hasRefunds) {
      html += `<tr><td colspan="6" style="text-align:center;padding:1rem;color:var(--text-secondary);">No refunds with this status.</td></tr>`;
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;

    document.getElementById('refundFilter')?.addEventListener('change', loadRefunds);

    const pendingRefunds = snapshot.docs.filter(d => (d.data().status || 'pending') === 'pending').length;
    const badge = document.getElementById('refundBadge');
    if (badge) badge.textContent = pendingRefunds;

  }, (error) => {
    console.error('Error loading refunds:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading refunds.</p>`;
  });
}

// ============================================================
//  MARK REFUND PAID (cash-out) — server callable, debits wallet
// ============================================================
export async function markRefundPaid(refundId) {
  // Fetch current amount for the confirmation prompt only.
  let amount = null;
  try {
    const snap = await getDoc(doc(db, 'refundRequests', refundId));
    if (snap.exists()) amount = Number(snap.data().amount || 0);
  } catch (_) {}

  const confirmMsg = amount != null
    ? `Have you already paid this customer R${amount.toFixed(2)} out-of-band (EFT / cash)?\n\n` +
      `Clicking OK will DEDUCT R${amount.toFixed(2)} from their app wallet to keep the balance correct.`
    : 'Have you already paid this customer out-of-band?\n\nClicking OK will DEDUCT the request amount from their app wallet.';

  if (!confirm(confirmMsg)) return;

  try {
    const fn = httpsCallable(getFunctions(), 'markRefundPaid');
    const result = await fn({ refundId });
    const d = result?.data || {};

    if (d.alreadyProcessed) {
      showToast('Refund was already marked paid.');
    } else {
      showToast(`✅ Marked paid. Wallet debited R${Number(d.appliedDebit || 0).toFixed(2)}.`);
    }
    // onSnapshot refreshes the table automatically.
  } catch (error) {
    console.error('Error marking refund paid:', error);
    showToast(`❌ ${error?.message || 'Failed to mark refund as paid.'}`);
  }
}

// ============================================================
//  REJECT REFUND — server callable, no wallet movement
// ============================================================
export async function rejectRefund(refundId) {
  if (!confirm('Reject this refund request? No money will move.')) return;
  try {
    const fn = httpsCallable(getFunctions(), 'rejectRefund');
    const result = await fn({ refundId });
    const d = result?.data || {};
    if (d.alreadyProcessed) {
      showToast('Refund was already rejected.');
    } else {
      showToast('Refund request rejected.');
    }
  } catch (error) {
    console.error('Error rejecting refund:', error);
    showToast(`❌ ${error?.message || 'Failed to reject refund.'}`);
  }
}

// ============================================================
//  VIEW REFUND
// ============================================================
export async function viewRefund(refundId) {
  try {
    const docSnap = await getDoc(doc(db, 'refundRequests', refundId));
    if (!docSnap.exists()) {
      showToast('Refund not found.');
      return;
    }
    const refund = docSnap.data();
    const status = refund.status || 'pending';

    const modal = openModal(`
      <div class="modal-content">
        <div class="modal-header">
          <h3>Refund Request</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>User:</strong> ${escapeHtml(refund.userName || 'Unknown')}</p>
          <p><strong>Phone:</strong> ${escapeHtml(refund.userPhone || 'N/A')}</p>
          <p><strong>Amount:</strong> ${formatMoney(refund.amount || 0)}</p>
          <p><strong>Status:</strong> ${escapeHtml(status.toUpperCase())}</p>
          <p><strong>Date:</strong> ${formatDateTime(refund.createdAt)}</p>
          ${refund.appliedDebit != null ? `<p><strong>Wallet debit applied:</strong> ${formatMoney(refund.appliedDebit)}</p>` : ''}
          ${refund.paidAt ? `<p><strong>Paid at:</strong> ${formatDateTime(refund.paidAt)}</p>` : ''}
          ${refund.rejectedAt ? `<p><strong>Rejected at:</strong> ${formatDateTime(refund.rejectedAt)}</p>` : ''}
          ${refund.message ? `<p><strong>Message:</strong> ${escapeHtml(refund.message)}</p>` : ''}
          <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
            <a href="tel:${escapeAttr(refund.userPhone || '')}" class="btn-sm" style="background:#28a745;color:#fff;padding:0.3rem 0.8rem;border-radius:4px;text-decoration:none;">
              <i class="fas fa-phone"></i> Call
            </a>
            <a href="https://wa.me/${String(refund.userPhone || '').replace(/\s/g, '')}" target="_blank" class="btn-sm" style="background:#25D366;color:#fff;padding:0.3rem 0.8rem;border-radius:4px;text-decoration:none;">
              <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
          </div>
        </div>
        <div class="modal-footer">
          ${status === 'pending' ? `
            <button class="btn-sm btn-approve" onclick="markRefundPaid('${refundId}');this.closest('.admin-modal').remove();" style="background:#28a745;color:#fff;">Mark Paid</button>
            <button class="btn-sm btn-reject" onclick="rejectRefund('${refundId}');this.closest('.admin-modal').remove();">Reject</button>
          ` : ''}
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Error viewing refund:', error);
    showToast('Error loading refund details.');
  }
}

// ============================================================
//  CREDIT NOTE MODAL
//
//  Idempotency:
//   - key generated once per modal open, stored in closure.
//   - button disabled the moment it is clicked.
//   - on failure, button re-enabled but the SAME key is reused
//     so a retry cannot double-credit.
//   - on success, button stays disabled; modal closes.
// ============================================================
export function openCreditNoteModal() {
  const idempotencyKey = 'cn_' + Date.now().toString(36) + '_' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10);

  const modal = openModal(`
    <div class="modal-content" style="max-width:500px;">
      <div class="modal-header">
        <h3><i class="fas fa-gift" style="color:var(--orange);"></i> Issue Credit Note</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Customer Phone Number</label>
          <input type="text" id="creditPhone" placeholder="+27 82 123 4567" />
        </div>
        <div class="form-group">
          <label>Amount (R)</label>
          <input type="number" id="creditAmount" placeholder="35.00" step="0.01" min="0" />
        </div>
        <div class="form-group">
          <label>Reason (optional)</label>
          <textarea id="creditReason" rows="2" placeholder="e.g. Free delivery compensation"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="issueCreditBtn">Issue Credit Note</button>
      </div>
    </div>
  `);

  const btn = modal.querySelector('#issueCreditBtn');

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;

    const phone = document.getElementById('creditPhone').value.trim();
    const amount = parseFloat(document.getElementById('creditAmount').value);
    const reason = document.getElementById('creditReason').value.trim();

    if (!phone) { showToast('Please enter a customer phone number.'); return; }
    if (!amount || amount <= 0) { showToast('Please enter a valid amount.'); return; }

    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Issuing...';

    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('phone', '==', phone)));
      if (usersSnap.empty) {
        showToast('No user found with that phone number.');
        btn.disabled = false;
        btn.innerHTML = originalLabel;
        return;
      }
      const userId = usersSnap.docs[0].id;

      const fn = httpsCallable(getFunctions(), 'issueCreditNote');
      const result = await fn({ userId, amount, reason, idempotencyKey });

      if (result?.data?.success) {
        showToast(`✅ Credit note of ${formatMoney(amount)} issued to ${phone}!`);
        closeModal(modal);
        // Do NOT re-enable — modal is closed.
        return;
      }

      // Unexpected non-success response — re-enable so the admin can retry
      // with the SAME key (server dedupes on it).
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    } catch (error) {
      console.error('Error issuing credit note:', error);
      showToast(`❌ ${error?.message || 'Failed to issue credit note.'}`);
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });
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