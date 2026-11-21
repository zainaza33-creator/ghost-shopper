// ============================================================
//  ADMIN-MAIN.JS - Main entry point for admin dashboard
//  Imports all modules and orchestrates the admin panel.
//  Registers FCM for admin push notifications.
// ============================================================

// ===== IMPORTS =====
import { auth, db } from '../../js/firebase-config.js';
import {
  doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getMessaging, getToken, onMessage
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js";

import { initAuth, getCurrentUser, getUserData } from './auth.js';
import { showToast, showLoading } from './utils.js';

// ===== IMPORT ALL MODULES =====
import './dashboard.js';
import '../../js/analytics.js';
import './analytics.js';
import './orders.js';
import './stores.js';
import './products.js';
import './specials.js';
import './drivers.js';
import './driverPayments.js';
import './itemRequests.js';
import './storeRequests.js';
import './storeApprovals.js';
import './refunds.js';
import './notifications.js';
import './areas.js';
import './settings.js';
import './testmode.js';
import './storeNotifications.js';

// ===== DOM ELEMENTS =====
const adminContent = document.getElementById('adminContent');
const pageTitle = document.getElementById('pageTitle');
const navItems = document.querySelectorAll('.nav-item');
const logoutBtn = document.getElementById('adminLogoutBtn');

// ===== STATE =====
let currentSection = 'dashboard';
let currentUser = null;
let userData = null;
let fcmInitialized = false;

// ===== FCM VAPID KEY (matches the customer app) =====
const VAPID_KEY = 'BFiovOEAOgZUXWJgo6h5bCw-MgoJmdZTyCjfGpy5EhArqnOlkQjkMjukgh_I74Z0A48XWNQWKy4_xeOAaCj6XMI';

// ===== EXPOSE GLOBALLY FOR INLINE CALLS =====
window.showToast = showToast;

// ===== NAVIGATION =====
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const section = item.dataset.section;
    currentSection = section;
    pageTitle.textContent = item.textContent.trim();
    document.getElementById('adminSidebar').classList.remove('open');
    loadSection(section);
  });
});

// ===== LOAD SECTION =====
function loadSection(section) {
  const loaders = {
    dashboard: window.loadDashboard,
    analytics: window.loadAnalytics,
    orders: window.loadOrders,
    storeNotifications: window.loadStoreNotifications,
    refunds: window.loadRefunds,
    drivers: window.loadDrivers,
    driverPayments: window.loadDriverPayments,
    itemRequests: window.loadItemRequests,
    storeRequests: window.loadStoreRequests,
    storeApprovals: window.loadStoreApprovals,
    stores: window.loadStores,
    products: window.loadProducts,
    specials: window.loadSpecials,
    areas: window.loadAreas,
    notifications: window.loadNotifications,
    settings: window.loadSettings,
    testmode: window.loadTestMode
  };

  const loader = loaders[section];
  if (loader) {
    loader();
  } else {
    console.warn(`No loader found for section: ${section}`);
    adminContent.innerHTML = `<p style="color:var(--red);">Section not implemented yet.</p>`;
  }
}

// ===== SIDEBAR TOGGLE =====
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('adminSidebar').classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('adminSidebar');
    if (!sidebar.contains(e.target) && !document.getElementById('sidebarToggle').contains(e.target)) {
      sidebar.classList.remove('open');
    }
  }
});

// ===== LOGOUT =====
logoutBtn.addEventListener('click', () => {
  auth.signOut().then(() => {
    window.location.replace('login.html');
  }).catch((error) => {
    console.error('Error signing out:', error);
    showToast('Error signing out.');
  });
});

// ============================================================
//  ADMIN FCM REGISTRATION
//  Saves the admin device's FCM token to users/{uid}.fcmTokens
//  so Cloud Functions can push notifications to admins.
// ============================================================
async function subscribeAdminToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('🔕 Admin push not supported on this device');
    return;
  }

  try {
    // Register the firebase-messaging-sw.js (lives at root of public/)
    // It's already registered by the customer app if they've visited.
    // For admin-only visits we register it here if not present.
    const registrations = await navigator.serviceWorker.getRegistrations();
    let fcmReg = registrations.find(r => r.active && r.active.scriptURL.includes('firebase-messaging-sw'));
    if (!fcmReg) {
      try {
        fcmReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      } catch (e) {
        console.warn('Admin FCM SW register failed:', e);
      }
    }

    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('🔕 Admin notification permission denied');
      return;
    }

    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) {
      console.warn('🔕 No admin FCM token received');
      return;
    }

    const user = auth.currentUser;
    if (!user) return;

    // Save token to the admin's users doc
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      console.warn('Admin user doc not found');
      return;
    }
    const currentTokens = userSnap.data().fcmTokens || [];
    if (!currentTokens.includes(token)) {
      const updated = [...currentTokens, token];
      await updateDoc(userRef, { fcmTokens: updated });
      console.log('✅ Admin FCM token saved');
    } else {
      console.log('ℹ️ Admin FCM token already exists');
    }

    // Foreground messages → show toast
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || 'Ghost Shopper';
      const body = payload.notification?.body || '';
      showToast(`🔔 ${title}${body ? ' — ' + body : ''}`, 5000);
    });

  } catch (err) {
    console.error('❌ Admin FCM registration error:', err);
  }
}

// ===== INIT =====
async function init() {
  showLoading('Loading admin panel...');

  try {
    const user = await initAuth();
    currentUser = user;

    const data = getUserData();
    userData = data;

    document.getElementById('adminName').textContent = userData?.name || 'Admin';

    loadSection('dashboard');

    // Register FCM in the background — never blocks the panel
    if (!fcmInitialized) {
      fcmInitialized = true;
      subscribeAdminToPush().catch(err => {
        console.warn('Admin FCM registration skipped:', err?.message || err);
      });
    }

  } catch (error) {
    console.error('Init error:', error);
    if (error.message !== 'Not authenticated' &&
        error.message !== 'Access denied' &&
        error.message !== 'User not found') {
      showToast('Error loading admin panel. Please refresh.');
      adminContent.innerHTML = `
        <div style="text-align:center;padding:2rem;">
          <i class="fas fa-exclamation-triangle" style="font-size:2rem;color:var(--orange);"></i>
          <h3>Something went wrong</h3>
          <p>${error.message}</p>
          <button onclick="location.reload()" class="btn-primary">Refresh</button>
        </div>
      `;
    }
  }
}

// Start the application
init();