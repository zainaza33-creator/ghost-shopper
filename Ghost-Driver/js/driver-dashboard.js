// ============================================================
//  driver-dashboard.js — Ghost Shopper Driver Dashboard
//  SPA-style tabs: Home / Orders / Profile
//  Auto online/offline. Immediate image uploads.
//  FCM to drivers/{uid}.fcmTokens. Request payment.
//  Pre-approval: driver edits everything except phone.
//  Post-approval: all locked, contact admin to change anything.
// ============================================================

console.log('🚀 driver-dashboard.js booting...');

import {
  auth, db, storage, functions, httpsCallable,
  doc, getDoc, updateDoc, onSnapshot, collection, query, where, getDocs,
  serverTimestamp
} from './firebase-config.js';
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js";

// ===== Constants =====
const BANK_EMAIL = 'wedeliverzn@gmail.com';
const ADMIN_WHATSAPP = '+27628989813';
const VAPID_KEY = 'BFiovOEAOgZUXWJgo6h5bCw-MgoJmdZTyCjfGpy5EhArqnOlkQjkMjukgh_I74Z0A48XWNQWKy4_xeOAaCj6XMI';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVE_ORDER_STATUSES = ['assigned', 'collected', 'on_the_way'];

const IMG_MAX_DIMENSION = 800;
const IMG_JPEG_QUALITY = 0.8;
const IMG_MAX_BYTES = 300 * 1024;

// ===== DOM =====
const loadingScreen = document.getElementById('loadingScreen');
const dashboardContainer = document.getElementById('dashboardContainer');
const toast = document.getElementById('toast');

// ===== Toast =====
let toastTimer = null;
function showToast(msg, duration = 3000) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ===== Firebase Functions =====
let driverAcceptOrder = null;
let driverHeartbeat = null;
let driverLogoutFn = null;
let requestDriverPaymentFn = null;
try {
  if (functions && typeof httpsCallable === 'function') {
    driverAcceptOrder = httpsCallable(functions, 'driverAcceptOrder');
    driverHeartbeat = httpsCallable(functions, 'driverHeartbeat');
    driverLogoutFn = httpsCallable(functions, 'driverLogout');
    requestDriverPaymentFn = httpsCallable(functions, 'requestDriverPayment');
  }
} catch (e) {
  console.warn('Functions SDK not available:', e);
}

// ===== State =====
let currentDriver = null;
let driverUid = null;
let unsubscribeOrders = null;
let unsubscribeAvailable = null;
let unsubscribeAssignedCheck = null;
let unsubscribePaymentStatus = null;
let heartbeatInterval = null;
let totalEarnings = 0;
let assignedOrdersCount = 0;
let activeOrdersCount = 0;
let storesCache = new Map();
let hideTimeout = null;
let idleTimer = null;
let currentPaymentRequest = null;
let fcmInitialized = false;
let currentTab = 'home';
let activeOrders = [];
let historyOrders = [];
let availableOrders = [];

// ============================================================
//  LOADER
// ============================================================
window.addEventListener('load', () => {
  setTimeout(hideLoader, 400);
  setTimeout(hideLoader, 5000);
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 400);
}

// ============================================================
//  AUTH + INIT
// ============================================================
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('driver-login.html');
    return;
  }

  if (!user.emailVerified) {
    renderFatal(
      'Email not verified',
      'Please check your email inbox (and spam folder) and click the verification link to activate your account.',
      [{ label: 'Logout', onclick: logout, primary: true }]
    );
    return;
  }

  const uid = user.uid;
  driverUid = uid;

  try {
    const snap = await getDoc(doc(db, 'drivers', uid));
    if (!snap.exists()) {
      renderFatal(
        'Driver account not found',
        'You are not registered as a driver. Please register first.',
        [{ label: 'Register', href: 'driver-register.html', primary: true }]
      );
      return;
    }

    currentDriver = snap.data();

    if (currentDriver.suspended) {
      renderFatal(
        'Account suspended',
        'Your driver account is suspended. Please contact admin.',
        [{ label: 'Logout', onclick: logout, primary: true }]
      );
      return;
    }

    if (currentDriver.approved) {
      await setOnline();
    }

    await loadStoresCache();
    await loadPaymentStatus();

    renderDashboard();
    initTabNav();

    if (currentDriver.approved) {
      loadOrders(uid);
      loadAvailableOrders(uid);
      checkAssignedOrders(uid);
      startIdleWatch();
      startHeartbeat();
      initFCM();
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

  } catch (err) {
    console.error('auth/load error:', err);
    renderFatal('Error loading driver data', err.message || 'Please refresh.');
  }
});

// ============================================================
//  FATAL ERROR
// ============================================================
function renderFatal(title, message, actions = []) {
  const actionsHtml = actions.map(a => {
    if (a.href) return `<a href="${a.href}" class="driver-btn-primary">${a.label}</a>`;
    const id = 'errBtn_' + Math.random().toString(36).slice(2, 8);
    setTimeout(() => document.getElementById(id)?.addEventListener('click', a.onclick), 0);
    return `<button id="${id}" class="driver-btn-primary" type="button">${a.label}</button>`;
  }).join('');
  dashboardContainer.innerHTML = `
    <div class="driver-empty-state">
      <div class="driver-empty-icon danger"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i></div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${actionsHtml}
    </div>
  `;
}

// ============================================================
//  STORES CACHE
// ============================================================
async function loadStoresCache() {
  try {
    const snap = await getDocs(collection(db, 'stores'));
    snap.forEach(d => {
      const data = d.data();
      storesCache.set(data.name, { id: d.id, ...data });
    });
  } catch (err) {
    console.warn('Could not load stores cache:', err);
  }
}

// ============================================================
//  ONLINE / OFFLINE (auto)
// ============================================================
async function setOnline() {
  if (!currentDriver?.approved) return;
  if (currentDriver.isOnline === true) return;
  try {
    await updateDoc(doc(db, 'drivers', driverUid), {
      isOnline: true,
      lastSeen: new Date(),
      updatedAt: new Date()
    });
    currentDriver.isOnline = true;
    updateStatusUI();
    startHeartbeat();
  } catch (e) { console.warn('setOnline failed:', e); }
}

async function setOffline(reason = 'idle') {
  if (currentDriver?.isOnline === false) return;
  try {
    await updateDoc(doc(db, 'drivers', driverUid), {
      isOnline: false,
      updatedAt: new Date()
    });
    currentDriver.isOnline = false;
    updateStatusUI();
    stopHeartbeat();
    console.log(`Driver went offline (${reason})`);
  } catch (e) { console.warn('setOffline failed:', e); }
}

function updateStatusUI() {
  document.querySelectorAll('.driver-status-dot').forEach(dot => {
    dot.className = 'driver-status-dot ' + (currentDriver?.isOnline ? 'online' : 'offline');
  });
  document.querySelectorAll('.driver-status-text').forEach(text => {
    text.textContent = currentDriver?.isOnline ? 'Online' : 'Offline';
  });
}

// ============================================================
//  IDLE WATCH — 5 min no interaction → offline
// ============================================================
function startIdleWatch() {
  const reset = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (currentDriver && !currentDriver.isOnline) {
      setOnline();
    }
    idleTimer = setTimeout(() => {
      if (assignedOrdersCount === 0) {
        setOffline('idle');
      }
    }, IDLE_TIMEOUT_MS);
  };

  ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(ev => {
    document.addEventListener(ev, reset, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reset();
  });
  reset();
}

// ============================================================
//  HEARTBEAT
// ============================================================
function startHeartbeat() {
  if (!driverHeartbeat) return;
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    try { await driverHeartbeat({}); } catch (_) {}
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============================================================
//  PROFILE COMPLETION
// ============================================================
function profileChecklist(driver) {
  return [
    { key: 'name',               label: 'Full name',                 done: !!(driver.name || (driver.firstName && driver.lastName)) },
    { key: 'phone',              label: 'Mobile number',             done: !!driver.phone },
    { key: 'email',              label: 'Email address',             done: !!driver.email },
    { key: 'vehicleReg',         label: 'Vehicle registration',      done: !!(driver.vehicleReg || '').trim() },
    { key: 'licenseNumber',      label: 'License number',            done: !!(driver.licenseNumber || '').trim() },
    { key: 'profilePhoto',       label: 'Profile photo',             done: !!driver.profilePhoto },
    { key: 'vehiclePhoto',       label: 'Vehicle photo',             done: !!driver.vehiclePhoto },
    { key: 'licensePhoto',       label: 'License photo',             done: !!driver.licensePhoto },
    { key: 'idDoc',              label: 'ID document (Front)',       done: !!driver.idDoc },
    // Optional: ID Back (does not block completion)
    { key: 'bankName',           label: 'Bank name',                 done: !!(driver.bankName || '').trim() },
    { key: 'bankAccountName',    label: 'Account holder name',       done: !!(driver.bankAccountName || '').trim() },
    { key: 'bankAccountNumber',  label: 'Account number',            done: !!(driver.bankAccountNumber || '').trim() },
    { key: 'bankLetter',         label: 'Bank confirmation letter',  done: !!(driver.bankConfirmationPdfUrl || driver.bankEmailSent) }
  ];
}

function profileCompletion(driver) {
  const items = profileChecklist(driver);
  const done = items.filter(i => i.done).length;
  return {
    items,
    done,
    total: items.length,
    percent: Math.round((done / items.length) * 100),
    complete: done === items.length
  };
}

// ============================================================
//  TAB NAV — desktop navbar tabs + mobile bottom nav
// ============================================================
function initTabNav() {
  document.querySelectorAll('.driver-nav-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('.driver-nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('navLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('mobileLogoutBtn')?.addEventListener('click', logout);
}

function switchTab(tab) {
  if (!['home', 'orders', 'profile'].includes(tab)) return;
  currentTab = tab;

  document.querySelectorAll('.driver-nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.driver-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  document.querySelectorAll('.driver-view').forEach(v => {
    v.hidden = v.dataset.view !== tab;
  });

  window.scrollTo({ top: 0, behavior: 'auto' });

  if (tab === 'orders') {
    renderOrdersView();
  } else if (tab === 'profile') {
    renderProfileView();
  } else {
    renderHomeView();
  }
}

// ============================================================
//  RENDER DASHBOARD (shell)
// ============================================================
function renderDashboard() {
  const driver = currentDriver || {};
  const approved = !!driver.approved;

  dashboardContainer.innerHTML = `
    <div class="driver-view" data-view="home" id="viewHome"></div>
    <div class="driver-view" data-view="orders" id="viewOrders" hidden></div>
    <div class="driver-view" data-view="profile" id="viewProfile" hidden></div>
  `;

  renderHomeView();
  if (approved) {
    renderOrdersView();
    renderProfileView();
  } else {
    renderOrdersView();
    renderProfileView();
  }
}

// ============================================================
//  HOME VIEW
// ============================================================
function renderHomeView() {
  const view = document.getElementById('viewHome');
  if (!view) return;

  const driver = currentDriver || {};
  const approved = !!driver.approved;
  const isOnline = !!driver.isOnline;
  const firstName = driver.firstName || (driver.name ? driver.name.split(' ')[0] : 'Rider');
  const completion = profileCompletion(driver);

  let html = '';

  html += `
    <section class="driver-hero driver-hero-dash">
      <div class="driver-hero-inner">
        <div class="driver-hero-greeting">
          <div class="driver-hero-eyebrow">
            <i class="fas fa-motorcycle" aria-hidden="true"></i>
            <span>Rider Portal</span>
          </div>
          <h1>Hi, ${escapeHtml(firstName)}</h1>
          <p>${approved ? 'Ready to accept deliveries.' : 'Finish your setup to start delivering.'}</p>
        </div>
      </div>
    </section>
  `;

  if (approved) {
    const rating = driver.rating || 0;
    const reviewCount = driver.reviewCount || 0;
    const ratingDisplay = rating > 0 ? `${rating} ★ (${reviewCount})` : 'No reviews yet';
    html += `
      <div class="driver-status-bar">
        <div class="driver-status-left">
          <span class="driver-status-dot ${isOnline ? 'online' : 'offline'}" aria-hidden="true"></span>
          <span class="driver-status-text">${isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div class="driver-status-right">
          <span class="driver-rating">${escapeHtml(ratingDisplay)}</span>
        </div>
      </div>
      ${renderEarningsRow()}
    `;
  }

  if (!completion.complete) {
    html += renderOnboardingCard(completion);
  } else if (!approved) {
    html += `
      <div class="driver-card driver-pending-card">
        <div class="driver-pending-icon" aria-hidden="true">
          <i class="fas fa-hourglass-half"></i>
        </div>
        <h3>Pending approval</h3>
        <p>Your profile is complete and under review. We'll notify you as soon as you're approved.</p>
        <button type="button" class="driver-btn-secondary" id="editProfileBtn">
          <i class="fas fa-pen" aria-hidden="true"></i> Review my details
        </button>
      </div>
    `;
  }

  if (approved) {
    html += `
      <div class="driver-card">
        <h3 class="driver-card-title">
          <i class="fas fa-truck" aria-hidden="true"></i> Active deliveries
        </h3>
        <div id="homeActiveOrdersList" class="driver-orders-list">
          <p class="driver-info">Loading your deliveries...</p>
        </div>
      </div>
    `;
  }

  view.innerHTML = html;

  document.getElementById('editProfileBtn')?.addEventListener('click', openEditProfileModal);
  document.getElementById('completeProfileBtn')?.addEventListener('click', openEditProfileModal);

  if (approved) {
    renderActiveOrdersInto('homeActiveOrdersList');
  }

  updateEarningsDisplay();
}

// ============================================================
//  ORDERS VIEW
// ============================================================
function renderOrdersView() {
  const view = document.getElementById('viewOrders');
  if (!view) return;

  const approved = !!currentDriver?.approved;

  if (!approved) {
    view.innerHTML = `
      <div class="driver-view-header">
        <h2><i class="fas fa-truck" aria-hidden="true"></i> Orders</h2>
        <p>Available after approval.</p>
      </div>
      <div class="driver-empty-state">
        <div class="driver-empty-icon"><i class="fas fa-hourglass-half"></i></div>
        <h2>Not available yet</h2>
        <p>Complete your profile and wait for admin approval to start receiving orders.</p>
      </div>
    `;
    return;
  }

  view.innerHTML = `
    <div class="driver-view-header">
      <h2><i class="fas fa-truck" aria-hidden="true"></i> Orders</h2>
      <p>All your deliveries — active, past, and available.</p>
    </div>

    <div class="driver-card">
      <h3 class="driver-card-title">
        <i class="fas fa-bolt" aria-hidden="true"></i> Available now
      </h3>
      <div id="viewAvailableOrdersList" class="driver-orders-list">
        <p class="driver-info">Loading available orders...</p>
      </div>
    </div>

    <div class="driver-card">
      <h3 class="driver-card-title">
        <i class="fas fa-shipping-fast" aria-hidden="true"></i> Active deliveries
      </h3>
      <div id="viewActiveOrdersList" class="driver-orders-list">
        <p class="driver-info">Loading...</p>
      </div>
    </div>

    <div class="driver-card">
      <h3 class="driver-card-title">
        <i class="fas fa-check-circle" aria-hidden="true"></i> History
      </h3>
      <div id="viewHistoryOrdersList" class="driver-orders-list">
        <p class="driver-info">Loading...</p>
      </div>
    </div>
  `;

  renderAvailableOrdersInto('viewAvailableOrdersList');
  renderActiveOrdersInto('viewActiveOrdersList');
  renderHistoryOrdersInto('viewHistoryOrdersList');
}

// ============================================================
//  PROFILE VIEW
// ============================================================
function renderProfileView() {
  const view = document.getElementById('viewProfile');
  if (!view) return;

  const driver = currentDriver || {};
  const approved = !!driver.approved;
  const completion = profileCompletion(driver);

  if (!approved) {
    view.innerHTML = `
      <div class="driver-view-header">
        <h2><i class="fas fa-user" aria-hidden="true"></i> Profile</h2>
        <p>Your details and setup progress.</p>
      </div>
      ${!completion.complete ? renderOnboardingCard(completion) : `
        <div class="driver-card driver-pending-card">
          <div class="driver-pending-icon" aria-hidden="true">
            <i class="fas fa-hourglass-half"></i>
          </div>
          <h3>Pending approval</h3>
          <p>Your profile is complete and under review.</p>
          <button type="button" class="driver-btn-secondary" id="profileEditBtn">
            <i class="fas fa-eye"></i> Review my details
          </button>
        </div>
      `}
    `;

    document.getElementById('completeProfileBtn')?.addEventListener('click', openEditProfileModal);
    document.getElementById('profileEditBtn')?.addEventListener('click', openEditProfileModal);
    return;
  }

  const photo = driver.profilePhoto || '';
  const name = driver.name || `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Driver';
  const phone = driver.phone || '';
  const email = driver.email || '—';
  const vehicleReg = driver.vehicleReg || '—';
  const licenseNumber = driver.licenseNumber || '—';
  const idDoc = driver.idDoc || '';
  const idDocBack = driver.idDocBack || '';
  const licensePhoto = driver.licensePhoto || '';
  const vehiclePhoto = driver.vehiclePhoto || '';
  const bankName = driver.bankName || '—';
  const bankAccountName = driver.bankAccountName || '—';
  const bankAccountNumber = driver.bankAccountNumber || '—';
  const bankLetter = driver.bankConfirmationPdfUrl || '';

  const photoHtml = photo
    ? `<img src="${escapeAttr(photo)}" alt="" class="driver-user-photo" onerror="this.src='img/placeholder.jpg'" />`
    : `<div class="driver-user-photo driver-user-photo-empty"><i class="fas fa-user"></i></div>`;

  view.innerHTML = `
    <div class="driver-view-header">
      <h2><i class="fas fa-user" aria-hidden="true"></i> Profile</h2>
      <p>Your details are locked. Contact admin to change anything.</p>
    </div>

    <div class="driver-card driver-user-card">
      <div class="driver-user-head">
        ${photoHtml}
        <div class="driver-user-info">
          <h3>${escapeHtml(name)}</h3>
          <p><i class="fas fa-phone"></i> ${escapeHtml(phone)}</p>
          <p><i class="fas fa-envelope"></i> ${escapeHtml(email)}</p>
        </div>
      </div>

      <div class="driver-profile-rows">
        <div class="driver-profile-row">
          <span class="label">Vehicle reg</span>
          <span class="value">${escapeHtml(vehicleReg)}</span>
        </div>
        <div class="driver-profile-row">
          <span class="label">License no.</span>
          <span class="value">${escapeHtml(licenseNumber)}</span>
        </div>
        <div class="driver-profile-row">
          <span class="label">Bank name</span>
          <span class="value">${escapeHtml(bankName)}</span>
        </div>
        <div class="driver-profile-row">
          <span class="label">Account holder</span>
          <span class="value">${escapeHtml(bankAccountName)}</span>
        </div>
        <div class="driver-profile-row">
          <span class="label">Account number</span>
          <span class="value">${escapeHtml(bankAccountNumber)}</span>
        </div>
        ${bankLetter ? `
          <div class="driver-profile-row">
            <span class="label">Bank letter</span>
            <span class="value"><a href="${escapeAttr(bankLetter)}" target="_blank" rel="noopener"><i class="fas fa-file-pdf"></i> View PDF</a></span>
          </div>
        ` : ''}
        ${idDoc ? `
          <div class="driver-profile-row">
            <span class="label">ID (Front)</span>
            <span class="value"><a href="${escapeAttr(idDoc)}" target="_blank" rel="noopener"><i class="fas fa-id-card"></i> View</a></span>
          </div>
        ` : ''}
        ${idDocBack ? `
          <div class="driver-profile-row">
            <span class="label">ID (Back)</span>
            <span class="value"><a href="${escapeAttr(idDocBack)}" target="_blank" rel="noopener"><i class="fas fa-id-card"></i> View</a></span>
          </div>
        ` : ''}
        ${licensePhoto ? `
          <div class="driver-profile-row">
            <span class="label">License photo</span>
            <span class="value"><a href="${escapeAttr(licensePhoto)}" target="_blank" rel="noopener"><i class="fas fa-image"></i> View</a></span>
          </div>
        ` : ''}
        ${vehiclePhoto ? `
          <div class="driver-profile-row">
            <span class="label">Vehicle photo</span>
            <span class="value"><a href="${escapeAttr(vehiclePhoto)}" target="_blank" rel="noopener"><i class="fas fa-image"></i> View</a></span>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="driver-card">
      <h3 class="driver-card-title"><i class="fas fa-wallet" aria-hidden="true"></i> Earnings</h3>
      ${renderEarningsRow()}
    </div>

    <div class="driver-card">
      <h3 class="driver-card-title"><i class="fas fa-headset" aria-hidden="true"></i> Need a change?</h3>
      <p class="driver-info" style="text-align:left;padding:0 0 12px;">
        Your profile is locked. Contact admin to update any of your details.
      </p>
      <button type="button" class="driver-btn-secondary" id="profileContactBtn" style="width:100%;">
        <i class="fas fa-headset"></i> Contact Admin
      </button>
    </div>
  `;

  document.getElementById('profileContactBtn')?.addEventListener('click', openContactAdminPanel);
  document.getElementById('requestPaymentBtn')?.addEventListener('click', requestPayment);
  updateEarningsDisplay();
  updatePaymentUI();
}

// ============================================================
//  EARNINGS + PAYMENT ROW
// ============================================================
function renderEarningsRow() {
  return `
    <div class="driver-earnings-row">
      <div class="driver-earn-pill">
        <span class="driver-earn-label">Today</span>
        <span class="driver-earn-value" data-earn="total">R0.00</span>
      </div>
      <div class="driver-earn-pill">
        <span class="driver-earn-label">Unpaid</span>
        <span class="driver-earn-value" data-earn="unpaid">R0.00</span>
      </div>
      <div class="driver-earn-pill">
        <span class="driver-earn-label">Paid</span>
        <span class="driver-earn-value" data-earn="paid">R0.00</span>
      </div>
    </div>
    <button type="button" class="driver-btn-primary small" id="requestPaymentBtn" disabled style="margin-top:12px;width:100%;">
      <i class="fas fa-hand-holding-usd" aria-hidden="true"></i> Request Payment
    </button>
    <p class="driver-payment-status" id="paymentStatus" style="font-size:0.78rem;margin:8px 0 0;line-height:1.45;"></p>
  `;
}

// ============================================================
//  ONBOARDING CARD
// ============================================================
function renderOnboardingCard(completion) {
  const itemsHtml = completion.items.map(item => `
    <li class="driver-check ${item.done ? 'done' : 'todo'}">
      <i class="fas ${item.done ? 'fa-check-circle' : 'fa-circle'}" aria-hidden="true"></i>
      <span>${escapeHtml(item.label)}</span>
    </li>
  `).join('');

  return `
    <div class="driver-card driver-onboarding">
      <div class="driver-onboarding-head">
        <h3>Finish your profile</h3>
        <span class="driver-onboarding-percent">${completion.percent}%</span>
      </div>
      <div class="driver-progress"><div class="driver-progress-fill" style="width:${completion.percent}%"></div></div>
      <p class="driver-onboarding-sub">Complete these steps to be approved and start delivering.</p>
      <ul class="driver-checklist">${itemsHtml}</ul>
      <button type="button" class="driver-btn-primary" id="completeProfileBtn">
        Continue setup
      </button>
    </div>
  `;
}

// ============================================================
//  ACTIVE ORDERS RENDER
// ============================================================
function renderActiveOrdersInto(containerId) {
  const list = document.getElementById(containerId);
  if (!list) return;

  if (activeOrders.length === 0) {
    list.innerHTML = `<p class="driver-info">No active deliveries right now.</p>`;
    return;
  }

  list.innerHTML = activeOrders.map(order => renderOrderCard(order, { showActions: true })).join('');
  wireOrderCardEvents(list);
}

// ============================================================
//  AVAILABLE ORDERS RENDER
// ============================================================
function renderAvailableOrdersInto(containerId) {
  const list = document.getElementById(containerId);
  if (!list) return;

  if (availableOrders.length === 0) {
    list.innerHTML = `<p class="driver-info">No orders available right now.</p>`;
    return;
  }

  list.innerHTML = availableOrders.map(order => renderAvailableOrderCard(order)).join('');
  wireAvailableOrderEvents(list);
}

// ============================================================
//  HISTORY RENDER
// ============================================================
function renderHistoryOrdersInto(containerId) {
  const list = document.getElementById(containerId);
  if (!list) return;

  if (historyOrders.length === 0) {
    list.innerHTML = `<p class="driver-info">No past deliveries yet.</p>`;
    return;
  }

  const today = new Date();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const groups = { Today: [], Yesterday: [], Older: [] };
  historyOrders.forEach(o => {
    const d = o.createdAt;
    if (d.toDateString() === today.toDateString()) groups.Today.push(o);
    else if (d.toDateString() === yest.toDateString()) groups.Yesterday.push(o);
    else groups.Older.push(o);
  });

  let html = '';
  Object.entries(groups).forEach(([label, arr]) => {
    if (!arr.length) return;
    const header = label === 'Older'
      ? arr[0].createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
      : label;
    html += `<h4 class="driver-group-header">${header}</h4>`;
    html += arr.map(order => renderOrderCard(order, { showActions: false })).join('');
  });

  list.innerHTML = html;
  wireOrderCardEvents(list);
}

// ============================================================
//  ORDER CARD
// ============================================================
function renderOrderCard(order, opts = {}) {
  const { showActions = false } = opts;
  const status = order.orderStatus || 'pending';
  const statusLabel = status.replace(/_/g, ' ').toUpperCase();
  const storeName = order.store || 'Store';
  const customerName = order.customerName || 'Customer';
  const customerPhone = order.customerPhone || '';
  const address = order.deliveryAddress?.street || 'No address';
  const isActive = ACTIVE_ORDER_STATUSES.includes(status);

  const store = storesCache.get(storeName);
  const storeAddress = store?.address || '';
  const storePhone = store?.phone || '';
  const storeMapsLink = storeAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(storeAddress)}`
    : '';

  let timeHtml = '';
  if (status === 'delivered') {
    const when = order.deliveredAt?.toDate ? order.deliveredAt.toDate() : (order.updatedAt?.toDate ? order.updatedAt.toDate() : null);
    timeHtml = when
      ? `<div class="driver-badge green"><i class="fas fa-check-circle"></i> Delivered at ${when.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</div>`
      : `<div class="driver-badge green"><i class="fas fa-check-circle"></i> Delivered</div>`;
  } else if (order.timeSlot?.end) {
    const now = new Date();
    const [eh, em] = order.timeSlot.end.split(':').map(Number);
    const endDate = new Date(); endDate.setHours(eh || 0, em || 0, 0, 0);
    const diff = endDate - now;
    if (diff > 0) {
      const mins = Math.floor(diff / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      timeHtml = `<div class="driver-badge"><i class="fas fa-hourglass-half"></i> ${h}h ${m}m left</div>`;
    } else {
      timeHtml = `<div class="driver-badge red"><i class="fas fa-exclamation-triangle"></i> Time window expired</div>`;
    }
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(item => {
    let tag = '✅';
    if (item.accepted === false && item.alternate) tag = '🔄';
    else if (item.accepted === false) tag = '❌';
    return `<span class="driver-item-tag">${tag} ${escapeHtml(item.name || '')}</span>`;
  }).join(' ');

  let actionsHtml = '';
  if (showActions && isActive) {
    if (status === 'assigned') {
      actionsHtml = `
        <div class="driver-order-actions">
          <button class="driver-btn-primary small green" data-action="mark-collected" data-id="${order.id}" type="button">
            <i class="fas fa-box"></i> Mark Collected
          </button>
        </div>
      `;
    } else if (status === 'collected') {
      actionsHtml = `
        <div class="driver-order-actions">
          <button class="driver-btn-primary small" data-action="mark-onway" data-id="${order.id}" data-address="${escapeAttr(address)}" type="button">
            <i class="fas fa-route"></i> Mark on the Way
          </button>
        </div>
      `;
    } else if (status === 'on_the_way') {
      actionsHtml = `
        <div class="driver-order-actions">
          <button class="driver-btn-primary small" data-action="mark-delivered" data-id="${order.id}" type="button">
            <i class="fas fa-check"></i> Mark Delivered
          </button>
        </div>
      `;
    }
  }

  return `
    <article class="driver-order ${isActive ? 'driver-order-active' : ''}" data-order-id="${order.id}">
      <div class="driver-order-head" data-toggle="${order.id}" role="button" tabindex="0">
        <span class="driver-order-id">#${order.id.slice(-6).toUpperCase()}</span>
        <span class="driver-order-status status-${escapeAttr(status)}">${escapeHtml(statusLabel)}</span>
        <span class="driver-order-chevron"><i class="fas fa-chevron-down" aria-hidden="true"></i></span>
      </div>
      <div class="driver-order-body" hidden>
        ${timeHtml}
        <div class="driver-order-line"><i class="fas fa-store" aria-hidden="true"></i> <strong>${escapeHtml(storeName)}</strong></div>
        ${storeAddress ? `<div class="driver-order-line"><i class="fas fa-map-pin" aria-hidden="true"></i> <a href="${storeMapsLink}" target="_blank" rel="noopener">${escapeHtml(storeAddress)}</a></div>` : ''}
        ${storePhone ? `<div class="driver-order-line"><i class="fas fa-phone" aria-hidden="true"></i> <a href="tel:${storePhone}">${escapeHtml(storePhone)}</a></div>` : ''}
        <div class="driver-order-line"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(customerName)}</div>
        ${customerPhone ? `<div class="driver-order-line"><i class="fas fa-phone" aria-hidden="true"></i> <a href="tel:${customerPhone}">${escapeHtml(customerPhone)}</a></div>` : ''}
        <div class="driver-order-line"><i class="fas fa-map-pin" aria-hidden="true"></i> <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}" target="_blank" rel="noopener">${escapeHtml(address)}</a></div>
        <div class="driver-order-items">${itemsHtml}</div>
        <div class="driver-order-total">Total: R${Number(order.total || 0).toFixed(2)}</div>
        ${actionsHtml}
      </div>
    </article>
  `;
}

// ============================================================
//  AVAILABLE ORDER CARD
// ============================================================
function renderAvailableOrderCard(order) {
  const orderId = order.id;
  const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date();
  const storeName = order.store || 'Store';
  const total = Number(order.total || 0);
  const address = order.deliveryAddress?.street || 'No address';
  const customerName = order.customerName || 'Customer';
  const customerPhone = order.customerPhone || '';
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsHtml = items.map(item => {
    let tag = '✅';
    if (item.accepted === false && item.alternate) tag = '🔄';
    else if (item.accepted === false) tag = '❌';
    return `<span class="driver-item-tag">${tag} ${escapeHtml(item.name || '')}</span>`;
  }).join(' ');

  return `
    <article class="driver-order driver-order-available">
      <div class="driver-order-head">
        <span class="driver-order-id">#${orderId.slice(-6).toUpperCase()}</span>
        <span class="driver-order-total">R${total.toFixed(2)}</span>
      </div>
      <div class="driver-order-body">
        <div class="driver-order-line"><i class="fas fa-store" aria-hidden="true"></i> ${escapeHtml(storeName)}</div>
        <div class="driver-order-line"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(customerName)}</div>
        ${customerPhone ? `<div class="driver-order-line"><i class="fas fa-phone" aria-hidden="true"></i> <a href="tel:${customerPhone}">${escapeHtml(customerPhone)}</a></div>` : ''}
        <div class="driver-order-line"><i class="fas fa-map-pin" aria-hidden="true"></i> ${escapeHtml(address)}</div>
        <div class="driver-order-line"><i class="fas fa-clock" aria-hidden="true"></i> ${createdAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</div>
        <div class="driver-order-items">${itemsHtml}</div>
      </div>
      <button class="driver-btn-primary small" data-orderid="${orderId}" type="button">
        Accept order
      </button>
    </article>
  `;
}

// ============================================================
//  WIRE ORDER CARD EVENTS
// ============================================================
function wireOrderCardEvents(scope) {
  scope.querySelectorAll('.driver-order-head[data-toggle]').forEach(head => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      toggleOrderCard(head);
    });
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleOrderCard(head);
      }
    });
  });

  scope.querySelectorAll('.driver-order-actions button[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const orderId = btn.dataset.id;
      if (action === 'mark-collected') await updateOrderStatus(orderId, 'collected', btn);
      else if (action === 'mark-onway') {
        const address = btn.dataset.address || '';
        if (address) window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`, '_blank');
        await updateOrderStatus(orderId, 'on_the_way', btn);
      }
      else if (action === 'mark-delivered') await markDeliveredFlow(orderId, btn);
    });
  });
}

function toggleOrderCard(head) {
  const card = head.closest('.driver-order');
  const body = head.nextElementSibling;
  if (!body) return;
  const isOpen = !body.hidden;
  body.hidden = isOpen;
  card?.classList.toggle('expanded', !isOpen);
  const chev = head.querySelector('.driver-order-chevron i');
  if (chev) chev.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
}

// ============================================================
//  ORDER ACTIONS
// ============================================================
async function updateOrderStatus(orderId, newStatus, btn) {
  if (btn) btn.disabled = true;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      orderStatus: newStatus,
      updatedAt: new Date(),
      ...(newStatus === 'collected' ? { collectedAt: new Date() } : {}),
      ...(newStatus === 'on_the_way' ? { onTheWayAt: new Date() } : {})
    });
    showToast('Status updated.');
  } catch (err) {
    console.error('status update error:', err);
    showToast('Could not update order.');
  }
  if (btn) btn.disabled = false;
}

async function markDeliveredFlow(orderId, btn) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.click();
  input.onchange = async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    if (btn) btn.disabled = true;
    try {
      showToast('Uploading proof of delivery...');
      const path = `delivery_photos/${orderId}/${Date.now()}.jpg`;
      const storageRef = ref(storage, path);
      await uploadBytesResumable(storageRef, file, { contentType: 'image/jpeg' });
      const photoUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'orders', orderId), {
        orderStatus: 'delivered',
        deliveryPhoto: photoUrl,
        deliveredAt: new Date(),
        updatedAt: new Date()
      });
      showToast('Order delivered.');
    } catch (err) {
      console.error('delivered error:', err);
      showToast('Could not save delivery. ' + (err.message || ''));
    }
    if (btn) btn.disabled = false;
  };
}

// ============================================================
//  WIRE AVAILABLE ORDER EVENTS
// ============================================================
function wireAvailableOrderEvents(scope) {
  scope.querySelectorAll('.driver-btn-primary[data-orderid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.orderid;
      if (!driverAcceptOrder) { showToast('Accept unavailable right now.'); return; }
      btn.disabled = true;
      try {
        const result = await driverAcceptOrder({ orderId, driverId: driverUid });
        if (result?.data?.success) {
          showToast('Order accepted!');
          await setOnline();
        } else {
          showToast(result?.data?.message || 'Could not accept order.');
        }
      } catch (err) {
        console.error('accept order error:', err);
        showToast('Could not accept order. ' + (err.message || ''));
      }
      btn.disabled = false;
    });
  });
}

// ============================================================
//  LOAD ORDERS (assigned to me)
// ============================================================
function loadOrders(uid) {
  if (unsubscribeOrders) { try { unsubscribeOrders(); } catch (_) {} }

  const q = query(
    collection(db, 'orders'),
    where('driverId', '==', uid),
    where('orderStatus', 'in', ['pending', 'confirmed', 'packing', 'ready', 'collected', 'on_the_way', 'delivered', 'assigned', 'cancelled'])
  );

  unsubscribeOrders = onSnapshot(q, (snapshot) => {
    const all = [];
    let earnings = 0;
    snapshot.forEach(d => {
      const order = d.data();
      const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
      all.push({ ...order, id: d.id, createdAt });
      if (order.orderStatus === 'delivered') {
        // Read the exact delivery fee from the order
        earnings += Number(order.deliveryFee || 20);
      }
    });
    totalEarnings = earnings;

    const actives = all.filter(o => ACTIVE_ORDER_STATUSES.includes(o.orderStatus));
    const history = all
      .filter(o => !ACTIVE_ORDER_STATUSES.includes(o.orderStatus) && !['ready', 'assigned'].includes(o.orderStatus))
      .sort((a, b) => b.createdAt - a.createdAt);

    activeOrders = actives.sort((a, b) => b.createdAt - a.createdAt);
    historyOrders = history;

    if (currentTab === 'home') renderActiveOrdersInto('homeActiveOrdersList');
    if (currentTab === 'orders') {
      renderActiveOrdersInto('viewActiveOrdersList');
      renderHistoryOrdersInto('viewHistoryOrdersList');
    }

    updateEarningsDisplay();
    updatePaymentUI();

  }, (err) => console.warn('assigned orders listener:', err));
}

// ============================================================
//  AVAILABLE ORDERS LISTENER
// ============================================================
function loadAvailableOrders(uid) {
  if (unsubscribeAvailable) { try { unsubscribeAvailable(); } catch (_) {} }

  const q = query(
    collection(db, 'orders'),
    where('orderStatus', '==', 'ready'),
    where('driverId', '==', null)
  );

  unsubscribeAvailable = onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach(d => {
      const order = d.data();
      const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
      list.push({ ...order, id: d.id, createdAt });
    });
    availableOrders = list;

    if (currentTab === 'orders') {
      renderAvailableOrdersInto('viewAvailableOrdersList');
    }
  }, (err) => console.warn('available orders listener:', err));
}

// ============================================================
//  ASSIGNED ORDERS COUNT (blocks logout)
// ============================================================
function checkAssignedOrders(uid) {
  if (unsubscribeAssignedCheck) { try { unsubscribeAssignedCheck(); } catch (_) {} }
  const q = query(
    collection(db, 'orders'),
    where('driverId', '==', uid),
    where('orderStatus', 'in', [...ACTIVE_ORDER_STATUSES, 'ready'])
  );
  unsubscribeAssignedCheck = onSnapshot(q, (snapshot) => {
    assignedOrdersCount = snapshot.size;
    let active = 0;
    snapshot.forEach(d => {
      const s = d.data().orderStatus;
      if (ACTIVE_ORDER_STATUSES.includes(s)) active++;
    });
    activeOrdersCount = active;
  }, (err) => console.warn('assigned orders listener:', err));
}

// ============================================================
//  EARNINGS DISPLAY
// ============================================================
function updateEarningsDisplay() {
  const paid = Number(currentDriver?.paidEarnings || 0);
  const unpaid = Math.max(0, totalEarnings - paid);
  document.querySelectorAll('[data-earn="total"]').forEach(el => el.textContent = `R${totalEarnings.toFixed(2)}`);
  document.querySelectorAll('[data-earn="unpaid"]').forEach(el => el.textContent = `R${unpaid.toFixed(2)}`);
  document.querySelectorAll('[data-earn="paid"]').forEach(el => el.textContent = `R${paid.toFixed(2)}`);
}

// ============================================================
//  PAYMENT REQUEST
// ============================================================
async function loadPaymentStatus() {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'driverPayments'),
        where('driverPhone', '==', driverUid),
        where('status', '==', 'requested')
      )
    );
    currentPaymentRequest = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    console.warn('Could not load payment status:', e);
    currentPaymentRequest = null;
  }
}

function updatePaymentUI() {
  const btn = document.getElementById('requestPaymentBtn');
  const statusEl = document.getElementById('paymentStatus');
  if (!btn || !statusEl) return;

  const paid = Number(currentDriver?.paidEarnings || 0);
  const unpaid = Math.max(0, totalEarnings - paid);

  if (currentPaymentRequest) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-hourglass-half"></i> Payment requested';
    const when = currentPaymentRequest.requestedAt?.toDate
      ? currentPaymentRequest.requestedAt.toDate().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
      : 'recently';
    statusEl.textContent = `Requested R${Number(currentPaymentRequest.amount || 0).toFixed(2)} on ${when} — pending admin approval`;
    statusEl.style.color = 'var(--orange-dark)';
  } else if (unpaid <= 0) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-hand-holding-usd"></i> Request Payment';
    statusEl.textContent = 'No unpaid earnings to request yet.';
    statusEl.style.color = 'var(--text-muted)';
  } else {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-hand-holding-usd"></i> Request Payment';
    statusEl.textContent = `You can request R${unpaid.toFixed(2)}.`;
    statusEl.style.color = 'var(--text-secondary)';
  }
}

async function requestPayment() {
  if (!requestDriverPaymentFn) {
    showToast('Payment request unavailable right now.');
    return;
  }
  const btn = document.getElementById('requestPaymentBtn');
  if (btn) btn.disabled = true;

  try {
    const result = await requestDriverPaymentFn({});
    if (result?.data?.success) {
      await loadPaymentStatus();
      updatePaymentUI();
      if (result.data.alreadyRequested) {
        showToast(`You already have a pending request for R${Number(result.data.amount || 0).toFixed(2)}.`);
      } else {
        showToast(`Payment request submitted for R${Number(result.data.amount || 0).toFixed(2)}.`);
      }
    } else {
      showToast('Could not submit payment request.');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    console.error('request payment error:', err);
    showToast(err.message || 'Could not submit payment request.');
    if (btn) btn.disabled = false;
  }
}

// ============================================================
//  EDIT PROFILE MODAL
// ============================================================
function openEditProfileModal() {
  const driver = currentDriver || {};
  const completion = profileCompletion(driver);
  const locked = !!driver.approved;

  const lockCls = locked ? ' driver-input-locked' : '';
  const lockAttr = locked ? ' readonly' : '';

  const overlay = document.createElement('div');
  overlay.className = 'driver-modal-overlay';
  overlay.innerHTML = `
    <div class="driver-modal">
      <div class="driver-modal-header">
        <h3>${locked ? 'Your profile' : (completion.complete ? 'Review your profile' : 'Complete your profile')}</h3>
        <button class="driver-modal-close" type="button" aria-label="Close">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>

      <div class="driver-modal-body">
        <div class="driver-progress" style="margin-bottom:14px;">
          <div class="driver-progress-fill" id="modalProgressFill" style="width:${completion.percent}%"></div>
        </div>

        ${locked ? `
          <div class="driver-modal-readonly-banner">
            <i class="fas fa-lock" aria-hidden="true"></i>
            <div>
              <strong>Your profile is locked.</strong>
              <span>To change any details, contact admin using the button below.</span>
            </div>
          </div>
        ` : ''}

        <div class="driver-form-field">
          <label for="editFullName">Full name</label>
          <input type="text" id="editFullName" value="${escapeAttr(driver.name || '')}" placeholder="Your full name" class="${lockCls.trim()}"${lockAttr} />
        </div>

        <div class="driver-form-field">
          <label>Mobile number</label>
          <input type="text" value="${escapeAttr(driver.phone || '')}" readonly class="driver-input-locked" />
          <small class="driver-form-hint">Verified number — contact admin to change.</small>
        </div>

        <div class="driver-form-field">
          <label for="editEmail">Email address</label>
          <input type="email" id="editEmail" value="${escapeAttr(driver.email || '')}" placeholder="your@email.com" class="${lockCls.trim()}"${lockAttr} />
        </div>

        <hr class="driver-modal-divider" />
        <h4 class="driver-modal-section">Vehicle & license</h4>

        <div class="driver-form-field">
          <label for="editVehicleReg">Vehicle registration</label>
          <input type="text" id="editVehicleReg" value="${escapeAttr(driver.vehicleReg || '')}" placeholder="e.g. ABC 123 GP" class="${lockCls.trim()}"${lockAttr} />
        </div>

        <div class="driver-form-field">
          <label for="editLicenseNumber">License number</label>
          <input type="text" id="editLicenseNumber" value="${escapeAttr(driver.licenseNumber || '')}" placeholder="e.g. 1234567890" class="${lockCls.trim()}"${lockAttr} />
        </div>

        <hr class="driver-modal-divider" />
        <h4 class="driver-modal-section">Photos & documents</h4>
        <p class="driver-modal-hint">${locked ? 'Contact admin to replace any of these.' : 'Images upload immediately. Files are compressed automatically.'}</p>

        <div class="driver-photo-row">
          ${renderPhotoTile('profilePhoto', 'Profile photo', driver.profilePhoto, 'fa-user', locked)}
          ${renderPhotoTile('vehiclePhoto', 'Vehicle photo', driver.vehiclePhoto, 'fa-motorcycle', locked)}
          ${renderPhotoTile('licensePhoto', 'License photo', driver.licensePhoto, 'fa-id-card', locked)}
          ${renderPhotoTile('idDoc', 'ID (Front)', driver.idDoc, 'fa-address-card', locked)}
          ${renderPhotoTile('idDocBack', 'ID (Back) - Optional', driver.idDocBack, 'fa-address-card', locked)}
        </div>

        <hr class="driver-modal-divider" />
        <h4 class="driver-modal-section">Bank confirmation letter</h4>

        <div class="driver-bank-letter">
          <div class="driver-bank-letter-status" id="bankLetterStatus">
            ${driver.bankConfirmationPdfUrl
              ? `<a href="${escapeAttr(driver.bankConfirmationPdfUrl)}" target="_blank" rel="noopener" class="driver-bank-letter-link"><i class="fas fa-file-pdf"></i> View uploaded PDF</a>`
              : driver.bankEmailSent
                ? `<span class="driver-bank-letter-ok"><i class="fas fa-check-circle"></i> Marked as emailed</span>`
                : `<span class="driver-bank-letter-none">Not uploaded yet</span>`}
          </div>
          ${locked ? '' : `
            <input type="file" id="bankPdfInput" accept="application/pdf" hidden />
            <div class="driver-bank-letter-actions">
              <button type="button" class="driver-btn-secondary small" id="bankPdfChooseBtn">
                <i class="fas fa-upload"></i> Upload PDF
              </button>
              <button type="button" class="driver-btn-secondary small" id="bankEmailBtn">
                <i class="fas fa-envelope"></i> Email instead
              </button>
            </div>
          `}
        </div>

        <hr class="driver-modal-divider" />
        <h4 class="driver-modal-section">Bank details</h4>

        <div class="driver-form-field">
          <label for="editBankName">Bank name</label>
          <input type="text" id="editBankName" value="${escapeAttr(driver.bankName || '')}" placeholder="e.g. Standard Bank" class="${lockCls.trim()}"${lockAttr} />
        </div>

        <div class="driver-form-field">
          <label for="editAccountName">Account holder name</label>
          <input type="text" id="editAccountName" value="${escapeAttr(driver.bankAccountName || '')}" placeholder="Full name on the account" class="${lockCls.trim()}"${lockAttr} />
        </div>

        <div class="driver-form-field">
          <label for="editAccountNumber">Account number</label>
          <input type="text" id="editAccountNumber" value="${escapeAttr(driver.bankAccountNumber || '')}" placeholder="e.g. 1234567890" class="${lockCls.trim()}"${lockAttr} />
        </div>

      </div>

      <div class="driver-modal-footer">
        <button type="button" class="driver-btn-secondary" id="modalCancelBtn">${locked ? 'Close' : 'Cancel'}</button>
        ${locked
          ? `<button type="button" class="driver-btn-primary" id="modalContactAdminBtn"><i class="fas fa-headset"></i> Contact Admin</button>`
          : `<button type="button" class="driver-btn-primary" id="modalSaveBtn">Save details</button>`
        }
      </div>

      ${locked ? `
        <div class="driver-contact-panel" id="contactPanel" hidden>
          <div class="driver-contact-panel-inner">
            <h4>How would you like to contact admin?</h4>
            <div class="driver-contact-actions">
              <a href="mailto:${BANK_EMAIL}?subject=${encodeURIComponent('Driver profile change request — ' + (driver.name || driverUid))}" class="driver-contact-option email">
                <i class="fas fa-envelope"></i>
                <span>Email</span>
                <small>${BANK_EMAIL}</small>
              </a>
              <a href="https://wa.me/${ADMIN_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent('Hi Ghost Shopper, I need to update my driver profile. Name: ' + (driver.name || '') + ' Phone: ' + (driver.phone || ''))}" target="_blank" rel="noopener" class="driver-contact-option whatsapp">
                <i class="fab fa-whatsapp"></i>
                <span>WhatsApp</span>
                <small>${ADMIN_WHATSAPP}</small>
              </a>
            </div>
            <button type="button" class="driver-btn-secondary small" id="closeContactPanelBtn">Cancel</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  if (!locked) {
    ['profilePhoto', 'vehiclePhoto', 'licensePhoto', 'idDoc', 'idDocBack'].forEach(field => {
      wirePhotoTile(overlay, field);
    });
  }

  const bankPdfInput = overlay.querySelector('#bankPdfInput');
  const bankPdfChooseBtn = overlay.querySelector('#bankPdfChooseBtn');
  const bankEmailBtn = overlay.querySelector('#bankEmailBtn');
  const bankLetterStatus = overlay.querySelector('#bankLetterStatus');

  if (!locked && bankPdfChooseBtn && bankPdfInput) {
    bankPdfChooseBtn.addEventListener('click', () => bankPdfInput.click());
    bankPdfInput.addEventListener('change', async () => {
      const file = bankPdfInput.files[0];
      bankPdfInput.value = '';
      if (!file) return;
      if (file.type !== 'application/pdf') {
        showToast('Please choose a PDF file.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('PDF is too large (max 5 MB).');
        return;
      }

      const original = bankLetterStatus.innerHTML;
      bankLetterStatus.innerHTML = `<span class="driver-bank-letter-uploading"><i class="fas fa-spinner fa-spin"></i> Uploading PDF...</span>`;

      try {
        const path = `drivers/${driverUid}/bank_confirmation_${Date.now()}.pdf`;
        const storageRef = ref(storage, path);
        const task = uploadBytesResumable(storageRef, file, { contentType: 'application/pdf' });
        await new Promise((resolve, reject) => {
          task.on('state_changed', null, reject, resolve);
        });
        const url = await getDownloadURL(storageRef);
        await updateDoc(doc(db, 'drivers', driverUid), {
          bankConfirmationPdfUrl: url,
          updatedAt: new Date()
        });
        currentDriver.bankConfirmationPdfUrl = url;
        bankLetterStatus.innerHTML = `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" class="driver-bank-letter-link"><i class="fas fa-file-pdf"></i> View uploaded PDF</a>`;
        showToast('Bank letter uploaded.');
        updateModalProgress(overlay);
        refreshAllViews();
      } catch (err) {
        console.error('bank pdf upload error:', err);
        bankLetterStatus.innerHTML = original;
        showToast('Could not upload PDF. ' + (err.message || ''));
      }
    });
  }

  if (!locked && bankEmailBtn) {
    bankEmailBtn.addEventListener('click', async () => {
      const name = currentDriver?.name || 'Driver';
      const uid = driverUid || '';
      const subject = encodeURIComponent('Driver bank confirmation letter — ' + name);
      const body = encodeURIComponent(
`Hi Ghost Shopper team,

Please find attached my bank confirmation letter.

Driver name: ${name}
Driver ID: ${uid}

Thanks.`
      );
      window.location.href = `mailto:${BANK_EMAIL}?subject=${subject}&body=${body}`;

      setTimeout(async () => {
        try {
          await updateDoc(doc(db, 'drivers', driverUid), {
            bankEmailSent: true,
            updatedAt: new Date()
          });
          currentDriver.bankEmailSent = true;
          bankLetterStatus.innerHTML = `<span class="driver-bank-letter-ok"><i class="fas fa-check-circle"></i> Marked as emailed</span>`;
          showToast('Marked bank letter as emailed.');
          updateModalProgress(overlay);
          refreshAllViews();
        } catch (e) {
          console.warn('could not mark bank email:', e);
        }
      }, 1500);
    });
  }

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  overlay.querySelector('.driver-modal-close').addEventListener('click', close);
  overlay.querySelector('#modalCancelBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const contactBtn = overlay.querySelector('#modalContactAdminBtn');
  const contactPanel = overlay.querySelector('#contactPanel');
  const closeContactBtn = overlay.querySelector('#closeContactPanelBtn');
  if (contactBtn && contactPanel) {
    contactBtn.addEventListener('click', () => { contactPanel.hidden = false; });
  }
  if (closeContactBtn && contactPanel) {
    closeContactBtn.addEventListener('click', () => { contactPanel.hidden = true; });
  }

  if (!locked) {
    overlay.querySelector('#modalSaveBtn').addEventListener('click', async () => {
      const saveBtn = overlay.querySelector('#modalSaveBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const updates = {
          name: overlay.querySelector('#editFullName').value.trim(),
          email: overlay.querySelector('#editEmail').value.trim(),
          vehicleReg: overlay.querySelector('#editVehicleReg').value.trim(),
          licenseNumber: overlay.querySelector('#editLicenseNumber').value.trim(),
          bankName: overlay.querySelector('#editBankName').value.trim(),
          bankAccountName: overlay.querySelector('#editAccountName').value.trim(),
          bankAccountNumber: overlay.querySelector('#editAccountNumber').value.trim(),
          updatedAt: serverTimestamp()
        };

        if (updates.name) {
          updates.firstName = updates.name.split(' ')[0] || updates.name;
          updates.lastName = updates.name.split(' ').slice(1).join(' ') || '';
        }

        await updateDoc(doc(db, 'drivers', driverUid), updates);
        currentDriver = { ...currentDriver, ...updates };

        showToast('Profile saved.');
        close();
        refreshAllViews();
      } catch (err) {
        console.error('save profile error:', err);
        showToast('Could not save. ' + (err.message || 'Please try again.'));
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save details';
      }
    });
  }
}

// ============================================================
//  CONTACT ADMIN PANEL (standalone, from profile view)
// ============================================================
function openContactAdminPanel() {
  const driver = currentDriver || {};
  const overlay = document.createElement('div');
  overlay.className = 'driver-modal-overlay';
  overlay.innerHTML = `
    <div class="driver-modal" style="max-width:480px;">
      <div class="driver-modal-header">
        <h3>Contact Admin</h3>
        <button class="driver-modal-close" type="button" aria-label="Close">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <div class="driver-modal-body">
        <p style="font-size:0.9rem;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;">
          Your profile is locked. To change any details, contact admin using one of the options below.
        </p>
        <div class="driver-contact-actions" style="grid-template-columns:1fr;">
          <a href="mailto:${BANK_EMAIL}?subject=${encodeURIComponent('Driver profile change request — ' + (driver.name || driverUid))}" class="driver-contact-option email">
            <i class="fas fa-envelope"></i>
            <span>Email</span>
            <small>${BANK_EMAIL}</small>
          </a>
          <a href="https://wa.me/${ADMIN_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent('Hi Ghost Shopper, I need to update my driver profile. Name: ' + (driver.name || '') + ' Phone: ' + (driver.phone || ''))}" target="_blank" rel="noopener" class="driver-contact-option whatsapp">
            <i class="fab fa-whatsapp"></i>
            <span>WhatsApp</span>
            <small>${ADMIN_WHATSAPP}</small>
          </a>
        </div>
      </div>
      <div class="driver-modal-footer">
        <button type="button" class="driver-btn-secondary" id="contactCloseBtn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  overlay.querySelector('.driver-modal-close').addEventListener('click', close);
  overlay.querySelector('#contactCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// ============================================================
//  PHOTO TILE
// ============================================================
function renderPhotoTile(field, label, url, icon, locked = false) {
  const preview = url
    ? `<img src="${escapeAttr(url)}" alt="" />`
    : `<i class="fas ${icon}" aria-hidden="true"></i>`;
  return `
    <div class="driver-photo-upload" data-field="${field}">
      <label>${escapeHtml(label)}</label>
      <div class="driver-photo-preview" data-preview>
        ${preview}
        <div class="driver-photo-overlay" data-overlay hidden>
          <div class="driver-photo-spinner"></div>
          <div class="driver-photo-percent" data-percent>0%</div>
          <div class="driver-photo-bar"><div class="driver-photo-bar-fill" data-bar></div></div>
        </div>
        <div class="driver-photo-done" data-done hidden><i class="fas fa-check"></i></div>
        <div class="driver-photo-error" data-error hidden><i class="fas fa-exclamation-triangle"></i></div>
      </div>
      ${locked ? '' : `
        <input type="file" data-input accept="image/*" hidden />
        <button type="button" class="driver-btn-secondary small" data-choose>Choose</button>
      `}
    </div>
  `;
}

function wirePhotoTile(overlay, field) {
  const tile = overlay.querySelector(`.driver-photo-upload[data-field="${field}"]`);
  if (!tile) return;
  const input = tile.querySelector('[data-input]');
  const chooseBtn = tile.querySelector('[data-choose]');
  if (!input || !chooseBtn) return;

  const preview = tile.querySelector('[data-preview]');
  const overlayEl = tile.querySelector('[data-overlay]');
  const percentEl = tile.querySelector('[data-percent]');
  const barEl = tile.querySelector('[data-bar]');
  const doneEl = tile.querySelector('[data-done]');
  const errorEl = tile.querySelector('[data-error]');

  chooseBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || !file.type.startsWith('image/')) return;

    doneEl.hidden = true;
    errorEl.hidden = true;
    overlayEl.hidden = false;
    percentEl.textContent = '0%';
    barEl.style.width = '0%';
    chooseBtn.disabled = true;

    try {
      const resizedBlob = await resizeImage(file);
      const path = `drivers/${driverUid}/${field}_${Date.now()}.jpg`;
      const storageRef = ref(storage, path);
      const task = uploadBytesResumable(storageRef, resizedBlob, { contentType: 'image/jpeg' });

      await new Promise((resolve, reject) => {
        task.on('state_changed',
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            percentEl.textContent = pct + '%';
            barEl.style.width = pct + '%';
          },
          reject,
          resolve
        );
      });

      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'drivers', driverUid), {
        [field]: url,
        updatedAt: new Date()
      });
      currentDriver[field] = url;

      overlayEl.hidden = true;
      preview.querySelector('img')?.remove();
      preview.querySelector('i')?.remove();
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      preview.insertBefore(img, preview.firstChild);
      doneEl.hidden = false;
      showToast('Uploaded.');
      updateModalProgress(overlay);
      refreshAllViews();
    } catch (err) {
      console.error('image upload error:', err);
      overlayEl.hidden = true;
      errorEl.hidden = false;
      showToast('Upload failed. ' + (err.message || ''));
      chooseBtn.textContent = 'Retry';
    }
    chooseBtn.disabled = false;
  });
}

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
              canvas.toBlob((b2) => b2 ? resolve(b2) : reject(new Error('Resize retry failed')), 'image/jpeg', 0.6);
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

function updateModalProgress(overlay) {
  const fill = overlay.querySelector('#modalProgressFill');
  if (!fill) return;
  const completion = profileCompletion(currentDriver);
  fill.style.width = completion.percent + '%';
}

// ============================================================
//  REFRESH ALL VIEWS
// ============================================================
function refreshAllViews() {
  const approved = !!currentDriver?.approved;
  renderHomeView();
  if (approved) {
    renderOrdersView();
    renderProfileView();
  }
}

// ============================================================
//  LOGOUT
// ============================================================
function logout() {
  if (activeOrdersCount > 0) {
    showToast('You can\'t log out while you have an active delivery.');
    return;
  }

  stopHeartbeat();
  if (idleTimer) clearTimeout(idleTimer);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (unsubscribeOrders) { try { unsubscribeOrders(); } catch (_) {} }
  if (unsubscribeAvailable) { try { unsubscribeAvailable(); } catch (_) {} }
  if (unsubscribeAssignedCheck) { try { unsubscribeAssignedCheck(); } catch (_) {} }
  if (unsubscribePaymentStatus) { try { unsubscribePaymentStatus(); } catch (_) {} }

  try { driverLogoutFn?.({}).catch(() => {}); } catch (_) {}
  try {
    updateDoc(doc(db, 'drivers', driverUid), { isOnline: false, updatedAt: new Date() }).catch(() => {});
  } catch (_) {}

  auth.signOut().then(() => {
    window.location.replace('driver-login.html');
  }).catch(() => {
    showToast('Could not sign out. Please try again.');
  });
}

// ============================================================
//  LIFECYCLE
// ============================================================
function handleBeforeUnload() {
  stopHeartbeat();
  try { driverLogoutFn?.({}).catch(() => {}); } catch (_) {}
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (document.hidden && activeOrdersCount === 0 && currentDriver?.isOnline) {
        setOffline('hidden');
      }
    }, 60000);
  } else {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  }
}

// ============================================================
//  FCM
// ============================================================
async function initFCM() {
  if (fcmInitialized) return;
  fcmInitialized = true;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('🔕 Push not supported');
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    let fcmReg = registrations.find(r => r.active && r.active.scriptURL.includes('firebase-messaging-sw'));
    if (!fcmReg) {
      try {
        fcmReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      } catch (e) {
        console.warn('FCM SW register failed:', e);
      }
    }

    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('🔕 Notification permission denied');
      return;
    }

    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) {
      console.warn('🔕 No FCM token received');
      return;
    }

    const currentTokens = currentDriver?.fcmTokens || [];
    if (!currentTokens.includes(token)) {
      const updated = [...currentTokens, token];
      await updateDoc(doc(db, 'drivers', driverUid), {
        fcmTokens: updated,
        updatedAt: new Date()
      });
      currentDriver.fcmTokens = updated;
      console.log('✅ Driver FCM token saved');
    }

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || 'Ghost Shopper';
      const body = payload.notification?.body || '';
      showToast(`🔔 ${title}${body ? ' — ' + body : ''}`, 5000);
    });

  } catch (err) {
    console.error('❌ FCM init error:', err);
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