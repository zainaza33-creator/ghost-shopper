// ============================================================
//  NOTIFICATIONS.JS - Push notification module
//
//  CHANGE: image is now uploaded via file input to Firebase
//  Storage instead of pasted as a URL. Resized to max 800px,
//  JPEG quality 0.8, uploaded to notifications/{ts}-{rand}.jpg.
// ============================================================

import {
  db, storage,
  collection, query, where, orderBy, limit, getDocs, onSnapshot,
  doc, getDoc, addDoc, serverTimestamp, getFunctions, httpsCallable
} from '../../js/firebase-config.js';
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";
import { showToast, showLoading, formatDateTime, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');

window.loadNotifications = loadNotifications;
window.selectAbandonedUsers = selectAbandonedUsers;

// Image resize params — same as products
const IMG_MAX_DIMENSION = 800;
const IMG_JPEG_QUALITY = 0.8;
const IMG_MAX_BYTES = 300 * 1024;

// ============================================================
//  FORMAT MONEY HELPER
// ============================================================
function formatMoney(amount) {
  if (!amount && amount !== 0) return 'R0.00';
  return 'R' + amount.toFixed(2);
}

// ============================================================
//  IMAGE HELPERS
// ============================================================
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > IMG_MAX_DIMENSION) {
          height = Math.round(height * (IMG_MAX_DIMENSION / width));
          width = IMG_MAX_DIMENSION;
        } else if (height > IMG_MAX_DIMENSION) {
          width = Math.round(width * (IMG_MAX_DIMENSION / height));
          height = IMG_MAX_DIMENSION;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Resize failed'));
            if (blob.size > IMG_MAX_BYTES) {
              canvas.toBlob(
                (b2) => b2 ? resolve(b2) : reject(new Error('Retry failed')),
                'image/jpeg',
                0.6
              );
            } else {
              resolve(blob);
            }
          },
          'image/jpeg',
          IMG_JPEG_QUALITY
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

async function uploadNotificationImage(file) {
  const resized = await resizeImage(file);
  const fname = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const storageRef = ref(storage, `notifications/${fname}`);
  await uploadBytes(storageRef, resized, { contentType: 'image/jpeg' });
  return await getDownloadURL(storageRef);
}

// ============================================================
//  LOAD NOTIFICATIONS
// ============================================================
export function loadNotifications() {
  showLoading('Loading notifications...');

  getDocs(collection(db, 'users')).then(usersSnap => {
    const users = [];
    usersSnap.forEach(doc => {
      const data = doc.data();
      if (data.role === 'customer') {
        users.push({
          id: doc.id,
          name: data.name || data.phone || 'User',
          phone: data.phone || ''
        });
      }
    });

    const notifRef = collection(db, 'notifications');
    const q = query(notifRef, orderBy('sentAt', 'desc'), limit(50));

    onSnapshot(q, (snapshot) => {
      let historyHtml = '';
      if (!snapshot.empty) {
        snapshot.forEach(doc => {
          const notif = doc.data();
          const recipientDisplay = notif.recipientIds?.length > 0
            ? `${notif.recipientIds.length} specific users`
            : 'All customers';
          historyHtml += `
            <div style="padding:0.5rem;border-bottom:1px solid var(--border);font-size:0.85rem;">
              <div style="display:flex;justify-content:space-between;">
                <span><strong>${escapeHtml(notif.title || 'Notification')}</strong></span>
                <span style="font-size:0.7rem;color:var(--text-muted);">${formatDateTime(notif.sentAt)}</span>
              </div>
              <div style="color:var(--text-secondary);">${escapeHtml(notif.message || '')}</div>
              ${notif.imageUrl ? `<div style="margin-top:4px;"><img src="${escapeAttr(notif.imageUrl)}" alt="Notification image" style="max-width:100px;max-height:60px;border-radius:4px;object-fit:cover;" /></div>` : ''}
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">Sent to: ${recipientDisplay} (${notif.recipientCount || 0} delivered)</div>
            </div>
          `;
        });
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const abandonedQuery = query(
        collection(db, 'abandoned_carts'),
        where('status', '==', 'abandoned'),
        where('abandonedAt', '>', thirtyDaysAgo)
      );

      getDocs(abandonedQuery).then(abandonedSnap => {
        const abandonedCarts = [];
        abandonedSnap.forEach(doc => {
          const cart = doc.data();
          if (cart.userId) {
            abandonedCarts.push({
              id: doc.id,
              userId: cart.userId,
              userPhone: cart.userPhone || 'Unknown',
              userName: cart.userName || 'User',
              items: cart.items || [],
              subtotal: cart.subtotal || 0,
              storeName: cart.storeName || 'Unknown'
            });
          }
        });

        adminContent.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
            <div class="settings-card">
              <h3 style="margin-bottom:1rem;"><i class="fas fa-paper-plane"></i> Send Notification</h3>

              ${abandonedCarts.length > 0 ? `
                <div style="background:#FFF7ED;padding:0.8rem;border-radius:8px;border:1px solid var(--orange);margin-bottom:1rem;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;color:var(--orange);">
                      <i class="fas fa-shopping-cart"></i> ${abandonedCarts.length} Abandoned Cart(s)
                    </span>
                    <button class="btn-sm btn-approve" onclick="selectAbandonedUsers()" style="font-size:0.7rem;">
                      Select All
                    </button>
                  </div>
                  <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.3rem;">
                    ${abandonedCarts.slice(0, 3).map(cart =>
                      `${escapeHtml(cart.userName)} (${formatMoney(cart.subtotal)})`
                    ).join(', ')}
                    ${abandonedCarts.length > 3 ? `+ ${abandonedCarts.length - 3} more` : ''}
                  </div>
                </div>
              ` : `
                <div style="background:#F0FDF4;padding:0.8rem;border-radius:8px;border:1px solid var(--green);margin-bottom:1rem;">
                  <span style="font-weight:600;color:var(--green);">
                    <i class="fas fa-check-circle"></i> No abandoned carts to recover
                  </span>
                </div>
              `}

              <div class="form-group">
                <label>Title *</label>
                <input type="text" id="notifTitle" placeholder="e.g. Come back! Your cart is waiting" />
              </div>
              <div class="form-group">
                <label>Message *</label>
                <textarea id="notifMessage" rows="4" placeholder="Enter your notification message..."></textarea>
              </div>
              <div class="form-group">
                <label>Image (optional)</label>
                <input type="file" id="notifImageFile" accept="image/*" />
                <div id="notifImagePreviewWrap" style="margin-top:8px;display:none;">
                  <img id="notifImagePreview" alt="Preview" style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid var(--border);display:block;" />
                  <button type="button" id="notifImageRemove" class="btn-sm btn-reject" style="margin-top:6px;">
                    <i class="fas fa-times"></i> Remove image
                  </button>
                </div>
                <small style="font-size:0.72rem;color:var(--text-muted);display:block;margin-top:4px;">Auto-resized to max 800px</small>
              </div>
              <div class="form-group">
                <label>Recipients</label>
                <select id="notifRecipients">
                  <option value="all">All Customers</option>
                  <option value="specific">Specific Customers</option>
                  <option value="abandoned">Users with Abandoned Carts</option>
                </select>
              </div>
              <div id="recipientSelect" style="display:none;">
                <div class="form-group">
                  <label>Select Customers</label>
                  <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:4px;">
                    ${users.map(u => `
                      <label style="display:block;padding:2px 4px;font-size:0.85rem;">
                        <input type="checkbox" class="user-checkbox" value="${u.id}" /> ${escapeHtml(u.name)} (${escapeHtml(u.phone || 'no phone')})
                      </label>
                    `).join('')}
                  </div>
                </div>
              </div>
              <div id="abandonedUserList" style="display:none;">
                <div class="form-group">
                  <label>Abandoned Cart Users</label>
                  <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:4px;background:#FFF7ED;">
                    ${abandonedCarts.length > 0 ? abandonedCarts.map(cart => {
                      const user = users.find(u => u.id === cart.userId);
                      return `
                        <label style="display:block;padding:2px 4px;font-size:0.85rem;">
                          <input type="checkbox" class="abandoned-user-checkbox" value="${cart.userId}" checked /> ${user ? escapeHtml(user.name) : escapeHtml(cart.userName)} (${escapeHtml(cart.userPhone || 'no phone')})
                        </label>
                      `;
                    }).join('') : '<div style="padding:0.5rem;color:var(--text-secondary);">No users with abandoned carts.</div>'}
                  </div>
                </div>
              </div>
              <button class="btn-save" id="sendNotifBtn" style="width:100%;">
                <i class="fas fa-paper-plane"></i> Send Notification
              </button>
            </div>

            <div class="settings-card">
              <h3 style="margin-bottom:1rem;"><i class="fas fa-history"></i> Notification History</h3>
              <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:0.5rem;">
                ${historyHtml || '<p style="color:var(--text-secondary);text-align:center;padding:1rem;">No notifications sent yet.</p>'}
              </div>
            </div>
          </div>
        `;

        // --- File input wiring ---
        let pendingImageFile = null;
        const fileInput = document.getElementById('notifImageFile');
        const previewWrap = document.getElementById('notifImagePreviewWrap');
        const previewImg = document.getElementById('notifImagePreview');
        const removeBtn = document.getElementById('notifImageRemove');

        fileInput?.addEventListener('change', () => {
          const f = fileInput.files[0];
          if (!f || !f.type.startsWith('image/')) return;
          pendingImageFile = f;
          const url = URL.createObjectURL(f);
          previewImg.src = url;
          previewWrap.style.display = 'block';
        });

        removeBtn?.addEventListener('click', () => {
          pendingImageFile = null;
          fileInput.value = '';
          previewImg.removeAttribute('src');
          previewWrap.style.display = 'none';
        });

        document.getElementById('notifRecipients')?.addEventListener('change', function() {
          const recipientSelect = document.getElementById('recipientSelect');
          const abandonedSelect = document.getElementById('abandonedUserList');
          recipientSelect.style.display = this.value === 'specific' ? 'block' : 'none';
          abandonedSelect.style.display = this.value === 'abandoned' ? 'block' : 'none';
        });

        document.getElementById('sendNotifBtn')?.addEventListener('click', async () => {
          const title = document.getElementById('notifTitle').value.trim();
          const message = document.getElementById('notifMessage').value.trim();
          const recipients = document.getElementById('notifRecipients').value;

          if (!title || !message) {
            showToast('Please enter both title and message.');
            return;
          }

          let userIds = [];
          let recipientNames = [];

          if (recipients === 'specific') {
            const checkboxes = document.querySelectorAll('.user-checkbox:checked');
            checkboxes.forEach(cb => {
              const user = users.find(u => u.id === cb.value);
              if (user) {
                userIds.push(user.id);
                recipientNames.push(user.name);
              }
            });
            if (userIds.length === 0) {
              showToast('Please select at least one customer.');
              return;
            }
          } else if (recipients === 'abandoned') {
            const checkboxes = document.querySelectorAll('.abandoned-user-checkbox:checked');
            checkboxes.forEach(cb => {
              const user = users.find(u => u.id === cb.value);
              if (user) {
                userIds.push(user.id);
                recipientNames.push(user.name);
              }
            });
            if (userIds.length === 0) {
              showToast('No abandoned cart users selected.');
              return;
            }
          }

          const sendBtn = document.getElementById('sendNotifBtn');
          sendBtn.disabled = true;
          sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

          try {
            // STEP 1: Upload image if one was chosen
            let imageUrl = '';
            if (pendingImageFile) {
              try {
                sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading image...';
                imageUrl = await uploadNotificationImage(pendingImageFile);
              } catch (imgErr) {
                console.error('Image upload failed:', imgErr);
                showToast('Image upload failed. Sending without image.');
                imageUrl = '';
              }
            }

            // STEP 2: Save notification doc
            const authMod = await import('../../js/firebase-config.js');
            const notifData = {
              title: title,
              message: message,
              imageUrl: imageUrl,
              icon: 'fa-bell',
              recipientIds: userIds,
              recipientNames: recipientNames,
              recipients: userIds,
              readBy: [],
              deletedFor: [],
              sentAt: serverTimestamp(),
              sentBy: authMod.auth?.currentUser?.uid || 'admin'
            };

            const docRef = await addDoc(collection(db, 'notifications'), notifData);
            console.log('📨 Notification saved to Firestore:', docRef.id);

            // STEP 3: Push
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending push...';
            const functions = getFunctions();
            const sendPushFn = httpsCallable(functions, 'sendPushNotification');

            const result = await sendPushFn({
              userIds: userIds,
              title: title,
              body: message,
              data: {
                type: 'admin_notification',
                notificationId: docRef.id,
                imageUrl: imageUrl || ''
              }
            });

            if (result.data.success) {
              const sentCount = result.data.sent || result.data.recipients || 0;
              await authMod.db && authMod.doc
                ? null
                : null;
              // Update recipient count
              const { doc: fsDoc, updateDoc } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js');
              await updateDoc(fsDoc(db, 'notifications', docRef.id), {
                recipientCount: sentCount,
                sentAt: serverTimestamp()
              });

              showToast(`✅ Notification sent to ${sentCount} users!`);
              loadNotifications();
            } else {
              showToast('⚠️ ' + (result.data.message || 'Failed to send notification.'));
              sendBtn.disabled = false;
              sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Notification';
            }
          } catch (error) {
            console.error('Error sending notification:', error);
            showToast('❌ Failed to send notification.');
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Notification';
          }
        });

      }).catch(error => {
        console.error('Error loading abandoned carts:', error);
      });
    }, (error) => {
      console.error('Error loading notification history:', error);
    });
  }).catch(error => {
    console.error('Error loading users:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading users for notifications.</p>`;
  });
}

// ============================================================
//  SELECT ABANDONED USERS
// ============================================================
export function selectAbandonedUsers() {
  const checkboxes = document.querySelectorAll('.abandoned-user-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
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