// ============================================================
//  UTILS.JS - Shared utilities for admin modules
// ============================================================

const toast = document.getElementById('toast');
let toastTimer = null;
const adminContent = document.getElementById('adminContent');

// ===== TOAST =====
export function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ===== LOADING =====
export function showLoading(message = 'Loading...') {
  adminContent.innerHTML = `
    <div style="text-align:center;padding:3rem;color:var(--text-secondary);">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem;display:block;margin-bottom:1rem;"></i>
      <p>${message}</p>
    </div>
  `;
}

// ===== STATUS BADGE =====
export function getStatusBadge(status) {
  const classes = {
    pending: 'status-pending',
    confirmed: 'status-confirmed',
    packing: 'status-packing',
    packed: 'status-packed',
    collected: 'status-collected',
    on_the_way: 'status-on_the_way',
    delivered: 'status-delivered',
    refunded: 'status-refunded',
    paid: 'status-paid',
    test_mode: 'status-test_mode',
    approved: 'status-approved',
    rejected: 'status-rejected',
    completed: 'status-completed'
  };

  const label = status.replace('_', ' ').toUpperCase();
  const cls = classes[status] || 'status-pending';
  return `<span class="status-badge ${cls}">${label}</span>`;
}

// ===== DATE FORMAT =====
export function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(timestamp) {
  if (!timestamp) return 'N/A';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ===== MONEY =====
export function formatMoney(amount) {
  return `R${(amount || 0).toFixed(2)}`;
}

// ===== MODAL HELPERS =====
//  Only closes via the X button or a specific action button.
//  Backdrop clicks are ignored. Body scroll is locked.
export function openModal(html) {
  const existing = document.querySelector('.admin-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = html;
  document.body.appendChild(modal);

  // Lock body scroll
  document.body.style.overflow = 'hidden';

  // NO backdrop click handler — modals only close via X or explicit action

  return modal;
}

export function closeModal(modal) {
  if (modal && modal.parentNode) {
    modal.remove();
    // Release body scroll lock
    document.body.style.overflow = '';
  }
}

// ===== EXPOSE TO WINDOW =====
window.showToast = showToast;
window.showLoading = showLoading;
window.openModal = openModal;
window.closeModal = closeModal;