// ============================================================
//  notifications.js — Ghost Shopper customer notification modal
//  Loaded dynamically by global.js when a bell is clicked.
//
//  [UPDATED]
//   - Detail image fits (object-fit: contain) and is clickable
//     to open full screen.
//   - Header bell refreshed on every render via the helper
//     exported from global.js.
// ============================================================

console.log('🔔 notifications.js loaded');

import { auth, db } from './firebase-config.js';
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, updateDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { showToast, openAuthModal, refreshHeaderNotifBadge } from './global.js';

let unsubscribe = null;
let modalEl = null;
let debounceTimer = null;
let stylesInjected = false;
let cachedNotifications = [];
let activeDetailId = null;

// ============================================================
//  INJECT STYLES (once)
// ============================================================
function injectStyles() {
  if (stylesInjected) return;
  if (document.getElementById('notifModalStyles')) {
    stylesInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = 'notifModalStyles';
  style.textContent = `
    .notif-modal-body {
      padding: 14px 16px;
      background: var(--bg);
    }
    @media (max-width: 480px) {
      .notif-modal-body { padding: 12px; }
    }

    .notif-loader {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px 20px;
      color: var(--text-secondary);
      font-size: 0.88rem;
    }
    .notif-loader i { font-size: 1.6rem; color: var(--orange); }

    .notif-mark-all-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: var(--radius-full);
      border: 1px solid var(--border); background: var(--bg);
      color: var(--text-secondary); font-family: inherit;
      font-size: 0.72rem; font-weight: 700; cursor: pointer;
      transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.15s;
      white-space: nowrap; min-height: 34px;
    }
    .notif-mark-all-btn i { font-size: 0.75rem; }
    .notif-mark-all-btn:hover {
      background: #eff6ff; border-color: var(--blue); color: var(--blue-d);
      transform: translateY(-1px);
    }
    @media (max-width: 480px) {
      .notif-mark-all-btn span { display: none; }
      .notif-mark-all-btn { padding: 7px 10px; min-width: 34px; justify-content: center; }
    }

    .notif-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 10px; padding: 44px 24px; text-align: center;
    }
    .notif-empty-icon {
      width: 68px; height: 68px; border-radius: 50%;
      background: var(--orange-soft); color: var(--orange);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 1.6rem; margin-bottom: 4px;
    }
    .notif-empty-icon.danger { background: #fee2e2; color: var(--red); }
    .notif-empty h3 { font-size: 1.02rem; font-weight: 800; color: var(--navy); margin: 0; }
    .notif-empty p { font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 4px; line-height: 1.5; max-width: 300px; }

    .notif-action-btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; padding: 11px 22px; border-radius: var(--radius-full);
      border: none; background: var(--orange); color: #fff;
      font-family: inherit; font-size: 0.88rem; font-weight: 700;
      cursor: pointer; min-height: 44px; margin-top: 6px;
      box-shadow: 0 4px 14px rgba(249,115,22,0.25); text-decoration: none;
    }
    .notif-action-btn:hover { background: var(--orange-dark); transform: translateY(-1px); }

    .notif-list { display: flex; flex-direction: column; gap: 8px; }

    .notif-item {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 14px; background: var(--surface);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      cursor: pointer; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.15s;
      text-align: left; width: 100%; font-family: inherit; color: inherit;
    }
    .notif-item:hover { border-color: var(--border-2); box-shadow: var(--shadow-sm); transform: translateY(-1px); }
    .notif-item.is-unread { background: var(--orange-soft); border-color: rgba(249,115,22,0.3); }
    .notif-item.is-read .notif-item-title { color: var(--text-secondary); font-weight: 600; }
    .notif-item.is-read .notif-item-message { color: var(--text-muted); }

    .notif-item-icon {
      width: 38px; height: 38px; border-radius: 50%;
      background: var(--bg); color: var(--orange);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.9rem; flex-shrink: 0;
    }
    .notif-item.is-unread .notif-item-icon { background: #fff; }

    .notif-item-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .notif-item-title { font-size: 0.88rem; font-weight: 700; color: var(--text); line-height: 1.35; overflow-wrap: anywhere; }
    .notif-item-message {
      font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5;
      white-space: pre-wrap; overflow-wrap: anywhere;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .notif-item-time { display: inline-flex; align-items: center; gap: 5px; font-size: 0.68rem; color: var(--text-muted); font-weight: 500; margin-top: 4px; }

    .notif-item-side { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }
    .notif-item-dot {
      width: 9px; height: 9px; border-radius: 50%; background: var(--orange);
      animation: notifPulse 1.8s ease-in-out infinite;
    }
    @keyframes notifPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(0.82); } }

    .notif-item-delete {
      width: 30px; height: 30px; border-radius: 50%; border: none;
      background: transparent; color: var(--text-muted); font-size: 0.78rem;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.2s, color 0.2s, transform 0.15s;
    }
    .notif-item-delete:hover { background: #fee2e2; color: var(--red); transform: scale(1.08); }

    /* Detail view */
    .notif-detail { display: flex; flex-direction: column; gap: 16px; animation: notifDetailIn 0.25s ease; }
    @keyframes notifDetailIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .notif-detail-back {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: var(--radius-full);
      border: 1.5px solid var(--navy); background: var(--surface);
      color: var(--navy); font-family: inherit; font-size: 0.8rem; font-weight: 700;
      cursor: pointer; min-height: 38px; align-self: flex-start;
      transition: background 0.2s, color 0.2s, transform 0.15s;
    }
    .notif-detail-back:hover { background: var(--navy); color: #fff; transform: translateX(-2px); }

    .notif-detail-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-lg); overflow: hidden;
    }

    /* [UPDATED] Image fits inside the card, clickable to open full screen */
    .notif-detail-image {
      width: 100%;
      max-height: 320px;
      object-fit: contain;
      background: #000;
      display: block;
      cursor: zoom-in;
      border-bottom: 1px solid var(--border);
    }

    .notif-detail-body { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
    .notif-detail-icon {
      width: 44px; height: 44px; border-radius: 50%;
      background: var(--orange-soft); color: var(--orange);
      display: inline-flex; align-items: center; justify-content: center; font-size: 1.05rem;
    }
    .notif-detail-title { font-size: 1.1rem; font-weight: 800; color: var(--navy); line-height: 1.3; margin: 0; overflow-wrap: anywhere; }
    .notif-detail-message { font-size: 0.92rem; color: var(--text); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
    .notif-detail-time {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.75rem; color: var(--text-muted); font-weight: 500;
      padding-top: 8px; border-top: 1px solid var(--border); margin-top: 4px;
    }
    .notif-detail-time i { color: var(--orange); }

    /* Fullscreen image viewer */
    .notif-image-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.94);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.22s ease;
      padding: 20px;
      cursor: zoom-out;
    }
    .notif-image-overlay.open { opacity: 1; }
    .notif-image-full {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      user-select: none;
      pointer-events: none;
      border-radius: 4px;
    }
    .notif-image-close {
      position: absolute;
      top: 14px; right: 14px;
      width: 44px; height: 44px; border-radius: 50%;
      border: none; background: rgba(255,255,255,0.15); color: #fff;
      font-size: 1rem; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .notif-image-close:hover { background: rgba(255,255,255,0.28); }

    @media (max-width: 480px) {
      .notif-item { padding: 10px 12px; gap: 10px; }
      .notif-item-icon { width: 34px; height: 34px; font-size: 0.8rem; }
      .notif-item-title { font-size: 0.84rem; }
      .notif-item-message { font-size: 0.76rem; }
      .notif-item-time { font-size: 0.64rem; }
      .notif-detail-body { padding: 14px; }
      .notif-detail-title { font-size: 1rem; }
      .notif-detail-message { font-size: 0.85rem; }
      .notif-detail-image { max-height: 260px; }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

// ============================================================
//  OPEN
// ============================================================
export function openNotificationModal() {
  injectStyles();

  const user = auth.currentUser;

  if (!user) {
    if (modalEl) closeModal();
    setTimeout(() => {
      try { openAuthModal(); } catch (_) {}
    }, 180);
    return;
  }

  if (modalEl) {
    closeModal();
    setTimeout(() => createAndShowModal(), 180);
    return;
  }

  if (debounceTimer) return;
  debounceTimer = setTimeout(() => { debounceTimer = null; }, 400);

  createAndShowModal();
}

// ============================================================
//  CREATE MODAL
// ============================================================
function createAndShowModal() {
  const user = auth.currentUser;
  if (!user) return;

  const modal = document.createElement('div');
  modal.className = 'gs-modal';
  modal.id = 'notificationModal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <div class="gs-modal-backdrop" data-notif-close></div>
    <div class="gs-modal-panel" role="document">
      <div class="gs-modal-header">
        <h2 class="gs-modal-title" id="notifModalTitle">
          <i class="fas fa-bell" aria-hidden="true"></i>
          Notifications
        </h2>
        <div class="gs-modal-header-actions">
          <button class="notif-mark-all-btn" type="button" id="notifMarkAllBtn" aria-label="Mark all as read">
            <i class="fas fa-check-double" aria-hidden="true"></i>
            <span>Mark all read</span>
          </button>
          <button class="gs-modal-close" type="button" aria-label="Close notifications" data-notif-close>
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="gs-modal-body notif-modal-body" id="notifModalBody">
        <div class="notif-loader">
          <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
          <p>Loading notifications...</p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modalEl = modal;

  requestAnimationFrame(() => modal.classList.add('open'));
  document.body.style.overflow = 'hidden';

  modal.querySelectorAll('[data-notif-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', handleEscape);

  const markAllBtn = modal.querySelector('#notifMarkAllBtn');
  if (markAllBtn) markAllBtn.addEventListener('click', markAllRead);

  loadNotifications();
}

// ============================================================
//  CLOSE
// ============================================================
function closeModal() {
  if (!modalEl) return;

  modalEl.classList.remove('open');
  const el = modalEl;
  modalEl = null;
  activeDetailId = null;

  document.removeEventListener('keydown', handleEscape);

  if (unsubscribe) {
    try { unsubscribe(); } catch (_) {}
    unsubscribe = null;
  }

  setTimeout(() => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    const anyOpen = document.querySelector('.gs-modal.open, .cart-modal.open, .product-modal.open, .install-sheet.open, .announcement-sheet.open');
    if (!anyOpen) document.body.style.overflow = '';
  }, 260);

  // [ADDED] Refresh header badge once the modal has closed
  setTimeout(() => {
    try { refreshHeaderNotifBadge(); } catch (_) {}
  }, 400);
}

function handleEscape(e) {
  if (e.key !== 'Escape') return;
  if (activeDetailId) {
    activeDetailId = null;
    renderCurrentView();
    return;
  }
  closeModal();
}

window.closeNotificationModal = closeModal;

// ============================================================
//  LOAD
// ============================================================
function loadNotifications() {
  const user = auth.currentUser;
  const body = document.getElementById('notifModalBody');
  if (!body) return;

  if (!user) {
    renderSignInPrompt(body);
    return;
  }

  const notifRef = collection(db, 'notifications');
  let q;
  try {
    q = query(notifRef, orderBy('sentAt', 'desc'), limit(50));
  } catch (_) {
    q = query(notifRef, orderBy('createdAt', 'desc'), limit(50));
  }

  if (unsubscribe) {
    try { unsubscribe(); } catch (_) {}
    unsubscribe = null;
  }

  unsubscribe = onSnapshot(q, (snapshot) => {
    const notifications = [];

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;

      const recipientIds = Array.isArray(data.recipientIds) ? data.recipientIds : [];
      let recipients = data.recipients || [];
      if (typeof recipients === 'string') recipients = [recipients];
      if (!Array.isArray(recipients)) recipients = [];

      const isForAll = recipientIds.length === 0 && recipients.length === 0;
      const isForUser = isForAll ||
                        recipientIds.includes(user.uid) ||
                        recipients.includes(user.uid);
      if (!isForUser) return;

      if (Array.isArray(data.deletedFor) && data.deletedFor.includes(user.uid)) return;

      const read = Array.isArray(data.readBy) && data.readBy.includes(user.uid);

      const ts = data.sentAt || data.createdAt || null;
      const date = ts && typeof ts.toDate === 'function'
        ? ts.toDate()
        : (ts ? new Date(ts) : new Date());

      notifications.push({ id, data, read, date, timeStr: formatNotifTime(date) });
    });

    cachedNotifications = notifications;
    renderCurrentView();

    // [ADDED] Update the header bell in real time as notifications change
    try { refreshHeaderNotifBadge(); } catch (_) {}
  }, (error) => {
    console.error('Error loading notifications:', error);
    const body = document.getElementById('notifModalBody');
    if (!body) return;
    body.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon danger">
          <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
        </div>
        <h3>Couldn't load notifications</h3>
        <p>${escapeHtml(error.message || 'Please try again.')}</p>
        <a class="notif-action-btn" href="my-orders.html">
          <i class="fas fa-truck" aria-hidden="true"></i>
          <span>Track your order</span>
        </a>
      </div>
    `;
  });
}

// ============================================================
//  RENDER DISPATCHER
// ============================================================
function renderCurrentView() {
  const user = auth.currentUser;
  const body = document.getElementById('notifModalBody');
  if (!body) return;

  if (activeDetailId) {
    const target = cachedNotifications.find(n => n.id === activeDetailId);
    if (target) {
      renderDetail(body, target);
      return;
    }
    activeDetailId = null;
  }

  renderNotifications(body, cachedNotifications, user);
}

// ============================================================
//  LIST RENDER
// ============================================================
function renderNotifications(container, notifications, user) {
  if (!notifications.length) {
    renderEmptyState(container);
    return;
  }

  const itemsHtml = notifications.map(n => {
    const icon = n.data.icon || 'fa-bell';
    const title = n.data.title || 'Notification';
    const message = n.data.message || '';

    return `
      <button class="notif-item ${n.read ? 'is-read' : 'is-unread'}" data-id="${n.id}" type="button">
        <div class="notif-item-icon">
          <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
        </div>
        <div class="notif-item-content">
          <div class="notif-item-title">${escapeHtml(title)}</div>
          ${message ? `<div class="notif-item-message">${escapeHtml(message)}</div>` : ''}
          <div class="notif-item-time">
            <i class="far fa-clock" aria-hidden="true"></i>
            ${escapeHtml(n.timeStr)}
          </div>
        </div>
        <div class="notif-item-side">
          ${!n.read ? `<span class="notif-item-dot" aria-label="Unread"></span>` : ''}
          <span class="notif-item-delete" role="button" tabindex="0" aria-label="Delete notification" data-delete-id="${n.id}">
            <i class="fas fa-trash-alt" aria-hidden="true"></i>
          </span>
        </div>
      </button>
    `;
  }).join('');

  container.innerHTML = `<div class="notif-list">${itemsHtml}</div>`;

  container.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.notif-item-delete')) return;

      const id = item.dataset.id;
      const notif = cachedNotifications.find(n => n.id === id);
      if (!notif) return;

      if (!notif.read) {
        try {
          await updateDoc(doc(db, 'notifications', id), { readBy: arrayUnion(user.uid) });
          notif.read = true;
          // [ADDED] Update header bell after marking as read
          try { refreshHeaderNotifBadge(); } catch (_) {}
        } catch (err) {
          console.warn('Could not mark as read:', err);
        }
      }

      activeDetailId = id;
      renderCurrentView();
    });
  });

  container.querySelectorAll('.notif-item-delete').forEach(btn => {
    const handler = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.deleteId;
      if (!id) return;
      if (!confirm('Delete this notification?')) return;
      try {
        await updateDoc(doc(db, 'notifications', id), { deletedFor: arrayUnion(user.uid) });
        showToast('Notification deleted.');
      } catch (err) {
        console.error('Error deleting notification:', err);
        showToast('Could not delete notification.');
      }
    };
    btn.addEventListener('click', handler);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });
  });
}

// ============================================================
//  DETAIL RENDER — [UPDATED]
//  Image fits and is clickable to open full screen.
// ============================================================
function renderDetail(container, n) {
  const icon = n.data.icon || 'fa-bell';
  const title = n.data.title || 'Notification';
  const message = n.data.message || '';
  const imageUrl = n.data.imageUrl || '';

  container.innerHTML = `
    <div class="notif-detail">
      <button class="notif-detail-back" type="button" id="notifDetailBack">
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
        <span>All notifications</span>
      </button>

      <article class="notif-detail-card">
        ${imageUrl ? `<img class="notif-detail-image" src="${escapeHtml(imageUrl)}" alt="" data-notif-image="1" onerror="this.style.display='none'" />` : ''}
        <div class="notif-detail-body">
          <div class="notif-detail-icon">
            <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
          </div>
          <h2 class="notif-detail-title">${escapeHtml(title)}</h2>
          ${message ? `<p class="notif-detail-message">${escapeHtml(message)}</p>` : ''}
          <div class="notif-detail-time">
            <i class="far fa-clock" aria-hidden="true"></i>
            ${escapeHtml(n.timeStr)}
          </div>
        </div>
      </article>
    </div>
  `;

  const back = document.getElementById('notifDetailBack');
  if (back) back.addEventListener('click', () => {
    activeDetailId = null;
    renderCurrentView();
  });

  const img = container.querySelector('[data-notif-image]');
  if (img) {
    img.addEventListener('click', () => openImageFullscreen(img.src));
  }
}

// ============================================================
//  FULLSCREEN IMAGE VIEWER — [ADDED]
// ============================================================
function openImageFullscreen(src) {
  if (!src) return;
  const existing = document.getElementById('notifImageOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'notifImageOverlay';
  overlay.className = 'notif-image-overlay';
  overlay.innerHTML = `
    <button class="notif-image-close" type="button" aria-label="Close image">
      <i class="fas fa-times"></i>
    </button>
    <img class="notif-image-full" src="${escapeHtml(src)}" alt="" />
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
    document.removeEventListener('keydown', escHandler);
  };
  const escHandler = (e) => { if (e.key === 'Escape') close(); };

  overlay.querySelector('.notif-image-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);
}

// ============================================================
//  EMPTY + SIGN-IN
// ============================================================
function renderEmptyState(container) {
  container.innerHTML = `
    <div class="notif-empty">
      <div class="notif-empty-icon">
        <i class="fas fa-bell-slash" aria-hidden="true"></i>
      </div>
      <h3>You're all caught up</h3>
      <p>No new notifications right now.</p>
      <a class="notif-action-btn" href="my-orders.html">
        <i class="fas fa-truck" aria-hidden="true"></i>
        <span>Track your order</span>
      </a>
    </div>
  `;
}

function renderSignInPrompt(container) {
  container.innerHTML = `
    <div class="notif-empty">
      <div class="notif-empty-icon">
        <i class="fas fa-user-lock" aria-hidden="true"></i>
      </div>
      <h3>Sign in to see notifications</h3>
      <p>You'll see your alerts here once you're signed in.</p>
      <button class="notif-action-btn" type="button" id="notifSignInBtn">
        <i class="fas fa-phone-alt" aria-hidden="true"></i>
        <span>Sign In</span>
      </button>
    </div>
  `;
  const btn = document.getElementById('notifSignInBtn');
  if (btn) btn.addEventListener('click', () => {
    closeModal();
    setTimeout(() => {
      try { openAuthModal(); } catch (_) {}
    }, 180);
  });
}

// ============================================================
//  MARK ALL READ
// ============================================================
async function markAllRead() {
  const user = auth.currentUser;
  if (!user) return;

  const unread = cachedNotifications.filter(n => !n.read);
  if (!unread.length) {
    showToast('No unread notifications.');
    return;
  }

  const promises = unread.map(n =>
    updateDoc(doc(db, 'notifications', n.id), { readBy: arrayUnion(user.uid) })
  );

  try {
    await Promise.all(promises);
    showToast(`${unread.length} marked as read.`);
    try { refreshHeaderNotifBadge(); } catch (_) {}
  } catch (err) {
    console.error('Error marking all as read:', err);
    showToast('Could not mark all as read.');
  }
}

// ============================================================
//  HELPERS
// ============================================================
function formatNotifTime(date) {
  if (!date || typeof date.getTime !== 'function') return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? '' : 's'} ago`;

  try {
    return date.toLocaleString('en-ZA', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return date.toDateString();
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.addEventListener('beforeunload', () => {
  if (unsubscribe) { try { unsubscribe(); } catch (_) {} unsubscribe = null; }
});