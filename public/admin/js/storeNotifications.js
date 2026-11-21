// ============================================================
//  STORENOTIFICATIONS.JS - Store WhatsApp notification module
// ============================================================

import { db, collection, query, where, orderBy, getDocs, onSnapshot, doc, getDoc, updateDoc, deleteDoc, addDoc, serverTimestamp } from '../../js/firebase-config.js';
import { showToast, showLoading, formatDateTime, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');
let storeNotifUnsubscribe = null;

window.loadStoreNotifications = loadStoreNotifications;
window.sendStoreWhatsApp = sendStoreWhatsApp;
window.viewStoreNotif = viewStoreNotif;
window.deleteStoreNotification = deleteStoreNotification;

export function loadStoreNotifications() {
  showLoading('Loading store notifications...');
  
  if (storeNotifUnsubscribe) storeNotifUnsubscribe();

  const notifRef = collection(db, 'storeNotifications');
  const q = query(notifRef, orderBy('createdAt', 'desc'));

  storeNotifUnsubscribe = onSnapshot(q, (snapshot) => {
    const count = snapshot.docs.filter(d => d.data().sent === false).length;
    document.getElementById('storeNotifBadge').textContent = count;

    if (snapshot.empty) {
      adminContent.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--text-secondary);">
          <i class="fas fa-check-circle" style="font-size:2rem;display:block;margin-bottom:1rem;color:var(--green);"></i>
          <h3>All store notifications sent!</h3>
          <p>No pending WhatsApp messages for stores.</p>
        </div>
      `;
      return;
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3><i class="fas fa-whatsapp" style="color:#25D366;"></i> Store Notifications</h3>
        <span class="badge" style="background:var(--orange);font-size:1rem;padding:0.3rem 0.8rem;">${count} pending</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Order #</th>
              <th>Store</th>
              <th>Primary Phone</th>
              <th>Status</th>
              <th>Message Preview</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    snapshot.forEach(doc => {
      const notif = doc.data();
      const notifId = doc.id;
      const orderId = notif.orderId || 'N/A';
      const storeName = notif.storeName || 'Unknown';
      const primary = notif.primaryPhone || 'N/A';
      const secondary = notif.secondaryPhone || '';
      const message = notif.message || '';
      const isSent = notif.sent === true;
      const createdAt = notif.createdAt ? notif.createdAt.toDate() : new Date();

      const preview = message.length > 60 ? message.substring(0, 60) + '...' : message;
      const statusLabel = isSent ? '✅ Sent' : '⏳ Pending';
      const statusClass = isSent ? 'status-confirmed' : 'status-pending';

      html += `
        <tr>
          <td><strong>#${orderId.slice(-6).toUpperCase()}</strong></td>
          <td>${storeName}</td>
          <td>${primary}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td style="font-size:0.8rem;color:var(--text-secondary);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview}</td>
          <td>
            <button class="btn-sm btn-view" onclick="viewStoreNotif('${notifId}')"><i class="fas fa-eye"></i></button>
            ${!isSent ? `
              <button class="btn-sm btn-whatsapp-primary" data-notifid="${notifId}" data-phone="${primary}" data-message="${message.replace(/"/g, '&quot;')}" style="background:#25D366;color:#fff;">
                <i class="fab fa-whatsapp"></i> Send
              </button>
              ${secondary ? `<button class="btn-sm btn-whatsapp-secondary" data-notifid="${notifId}" data-phone="${secondary}" data-message="${message.replace(/"/g, '&quot;')}" style="background:#25D366;color:#fff;opacity:0.7;">
                <i class="fab fa-whatsapp"></i> 2nd
              </button>` : ''}
            ` : ''}
            <button class="btn-sm btn-delete" data-notifid="${notifId}" style="background:#dc3545;color:#fff;">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;

    // Send WhatsApp
    document.querySelectorAll('.btn-whatsapp-primary, .btn-whatsapp-secondary').forEach(btn => {
      btn.addEventListener('click', function() {
        const notifId = this.dataset.notifid;
        const phone = this.dataset.phone;
        const message = this.dataset.message;
        sendStoreWhatsApp(notifId, phone, message);
      });
    });

    // Delete
    document.querySelectorAll('.btn-delete[data-notifid]').forEach(btn => {
      btn.addEventListener('click', function() {
        const notifId = this.dataset.notifid;
        if (confirm('Delete this store notification?')) {
          deleteStoreNotification(notifId);
        }
      });
    });

  }, (error) => {
    console.error('Error loading store notifications:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading store notifications.</p>`;
  });
}

// ===== SEND STORE WHATSAPP =====
export async function sendStoreWhatsApp(notifId, phone, message) {
  if (!phone || phone === 'N/A') {
    showToast('No phone number available.');
    return;
  }

  const formattedPhone = phone.replace(/\s/g, '');
  const encodedMessage = encodeURIComponent(message);
  const waUrl = `https://wa.me/${formattedPhone}?text=${encodedMessage}`;

  window.open(waUrl, '_blank');

  try {
    await updateDoc(doc(db, 'storeNotifications', notifId), {
      sent: true,
      sentAt: serverTimestamp()
    });
    showToast('✅ Notification marked as sent!');
    loadStoreNotifications();
  } catch (error) {
    console.error('Error marking notification as sent:', error);
  }
}

// ===== DELETE STORE NOTIFICATION =====
export async function deleteStoreNotification(notifId) {
  try {
    await deleteDoc(doc(db, 'storeNotifications', notifId));
    showToast('🗑️ Notification deleted.');
    loadStoreNotifications();
  } catch (error) {
    console.error('Error deleting notification:', error);
    showToast('❌ Failed to delete notification.');
  }
}

// ===== VIEW STORE NOTIFICATION =====
export async function viewStoreNotif(notifId) {
  try {
    const docRef = doc(db, 'storeNotifications', notifId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Notification not found.');
      return;
    }
    const notif = docSnap.data();

    const modal = openModal(`
      <div class="modal-content" style="max-width:600px;">
        <div class="modal-header">
          <h3>Store Notification Details</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>Order ID:</strong> #${(notif.orderId || '').slice(-6).toUpperCase()}</p>
          <p><strong>Store:</strong> ${notif.storeName || 'Unknown'}</p>
          <p><strong>Primary Phone:</strong> ${notif.primaryPhone || 'N/A'}</p>
          <p><strong>Secondary Phone:</strong> ${notif.secondaryPhone || 'N/A'}</p>
          <p><strong>Sent:</strong> ${notif.sent ? '✅ Yes' : '⏳ No'}</p>
          <p><strong>Created:</strong> ${formatDateTime(notif.createdAt)}</p>
          <hr>
          <h4>Message</h4>
          <div style="background:var(--bg);padding:0.8rem;border-radius:8px;white-space:pre-wrap;font-size:0.85rem;border:1px solid var(--border);max-height:300px;overflow-y:auto;">
            ${notif.message || 'No message'}
          </div>
          <hr>
          <h4>Acceptance Link</h4>
          <div style="background:var(--bg);padding:0.8rem;border-radius:8px;font-size:0.8rem;word-break:break-all;border:1px solid var(--border);">
            <a href="${notif.acceptUrl || '#'}" target="_blank">${notif.acceptUrl || 'No link'}</a>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Error viewing notification:', error);
    showToast('Error loading notification details.');
  }
}