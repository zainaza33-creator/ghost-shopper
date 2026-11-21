// ============================================================
//  ADMIN.JS - Ghost Shopper Admin Dashboard (FULL UPDATED)
//  Includes: compact dashboard, analytics fix, orders archive,
//  refunds credit notes, driver management, store catalogs,
//  product improvements, specials with emojis, test mode
// ============================================================

import { auth, db } from './firebase-config.js';
import { 
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, 
  collection, query, where, orderBy, limit, getDocs, onSnapshot,
  serverTimestamp, Timestamp, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
// ---- FIX: Import getFunctions and httpsCallable ----
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";

// ===== IMPORT ANALYTICS & GLOBAL =====
import { getAnalytics } from './analytics.js';
import { updateNotificationBadge, initGlobal, getUnreadNotificationCount } from './global.js';

// ========== DOM Elements ==========
const adminContent = document.getElementById('adminContent');
const pageTitle = document.getElementById('pageTitle');
const toast = document.getElementById('toast');
const sidebarToggle = document.getElementById('sidebarToggle');
const adminSidebar = document.getElementById('adminSidebar');
const navItems = document.querySelectorAll('.nav-item');
const logoutBtn = document.getElementById('adminLogoutBtn');

// ========== State ==========
let currentUser = null;
let userData = null;
let currentSection = 'dashboard';
let unsubscribeListeners = [];
let archivedVisible = false;

// ========== Toast ==========
let toastTimer = null;
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ========== Loading ==========
function showLoading() {
  adminContent.innerHTML = `
    <div style="text-align:center;padding:3rem;color:var(--text-secondary);">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem;display:block;margin-bottom:1rem;"></i>
      <p>Loading...</p>
    </div>
  `;
}

// ========== Auth Check ==========
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  
  try {
    const docRef = doc(db, 'users', user.uid);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      showToast('User not found. Redirecting...');
      setTimeout(() => window.location.replace('index.html'), 1500);
      return;
    }

    userData = docSnap.data();
    const role = userData.role || 'customer';

    if (role !== 'admin') {
      showToast('Access denied. Admin only.');
      setTimeout(() => {
        if (role === 'driver') {
          window.location.replace('driver-dashboard.html');
        } else {
          window.location.replace('index.html');
        }
      }, 1500);
      return;
    }

    document.getElementById('adminName').textContent = userData.name || 'Admin';
    
    initGlobal();
    loadDashboard();

  } catch (error) {
    console.error('Error fetching user data:', error);
    showToast('Error loading user data.');
  }
});

// ========== Logout ==========
logoutBtn.addEventListener('click', () => {
  auth.signOut().then(() => {
    window.location.replace('login.html');
  }).catch((error) => {
    console.error('Error signing out:', error);
    showToast('Error signing out.');
  });
});

// ========== Navigation ==========
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const section = item.dataset.section;
    currentSection = section;
    pageTitle.textContent = item.textContent.trim();
    adminSidebar.classList.remove('open');
    
    loadSection(section);
  });
});

function loadSection(section) {
  switch(section) {
    case 'dashboard': loadDashboard(); break;
    case 'analytics': loadAnalytics(); break;
    case 'orders': loadOrders(); break;
    case 'refunds': loadRefunds(); break;
    case 'drivers': loadDrivers(); break;
    case 'stores': loadStores(); break;
    case 'products': loadProducts(); break;
    case 'specials': loadSpecials(); break;
    case 'areas': loadAreas(); break;
    case 'storeNotifications': loadStoreNotifications(); break;
    case 'notifications': loadNotifications(); break;
    case 'settings': loadSettings(); break;
    case 'testmode': loadTestMode(); break;
    default: loadDashboard();
  }
}

function loadCurrentSection() {
  loadSection(currentSection);
}

// ========== Sidebar Toggle ==========
sidebarToggle.addEventListener('click', () => {
  adminSidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768) {
    if (!adminSidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
      adminSidebar.classList.remove('open');
    }
  }
});

// ========== Cleanup ==========
window.addEventListener('beforeunload', () => {
  unsubscribeListeners.forEach(unsubscribe => {
    if (unsubscribe) unsubscribe();
  });
});

// ============================================================
//  DASHBOARD (with downloads and compact tiles)
// ============================================================
async function loadDashboard() {
  showLoading();
  updateNotificationBadge();
  
  try {
    const ordersSnap = await getDocs(collection(db, 'orders'));
    const driversSnap = await getDocs(collection(db, 'drivers'));
    const storesSnap = await getDocs(collection(db, 'stores'));
    const productsSnap = await getDocs(collection(db, 'products'));
    const usersSnap = await getDocs(collection(db, 'users'));
    const refundsSnap = await getDocs(collection(db, 'refundRequests'));
    const installsSnap = await getDocs(collection(db, 'analytics_installs'));
    const driverPaymentsSnap = await getDocs(collection(db, 'driverPayments'));
    
    let totalEarnings = 0;
    let totalDeliveries = 0;
    let totalDeliveryFees = 0;
    let pendingOrders = 0;
    let approvedDrivers = 0;
    let pendingDrivers = 0;
    let outOfStockProducts = 0;
    let totalUsers = 0;
    let pendingRefunds = 0;
    let totalInstalls = installsSnap.size;
    let totalPaidToDrivers = 0;

    // Orders stats
    ordersSnap.forEach(doc => {
      const order = doc.data();
      if (order.orderStatus === 'pending' || order.orderStatus === 'confirmed') {
        pendingOrders++;
      }
      if (order.orderStatus === 'delivered') {
        totalEarnings += (order.total || 0);
        totalDeliveries++;
        totalDeliveryFees += (order.deliveryFee || 35);
      }
    });

    // Driver payments
    driverPaymentsSnap.forEach(doc => {
      const payment = doc.data();
      totalPaidToDrivers += (payment.amount || 0);
    });

    driversSnap.forEach(doc => {
      const driver = doc.data();
      if (driver.approved) approvedDrivers++;
      else pendingDrivers++;
    });

    productsSnap.forEach(doc => {
      const product = doc.data();
      if (product.stock === false) outOfStockProducts++;
    });

    usersSnap.forEach(doc => {
      const data = doc.data();
      if (data.role === 'customer') totalUsers++;
    });

    refundsSnap.forEach(doc => {
      const refund = doc.data();
      if (refund.status === 'pending') pendingRefunds++;
    });

    let deliveryFee = 35;
    const settingsDoc = await getDoc(doc(db, 'settings', 'delivery'));
    if (settingsDoc.exists()) {
      deliveryFee = settingsDoc.data().fee || 35;
    }

    const fiveMinsAgo = new Date();
    fiveMinsAgo.setMinutes(fiveMinsAgo.getMinutes() - 5);
    const onlineQuery = query(
      collection(db, 'analytics_sessions'),
      where('lastActive', '>', fiveMinsAgo)
    );
    const onlineSnap = await getDocs(onlineQuery);
    const onlineUsers = onlineSnap.size;

    // ---- Compact Tile Layout ----
    adminContent.innerHTML = `
      <div class="stats-grid compact">
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-users"></i></div>
          <div class="stat-number">${totalUsers}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-users"></i></div>
          <div class="stat-number" id="dashboardOnlineCount">${onlineUsers}</div>
          <div class="stat-label">Online Now</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-download"></i></div>
          <div class="stat-number">${totalInstalls}</div>
          <div class="stat-label">App Downloads</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-shopping-bag"></i></div>
          <div class="stat-number">${ordersSnap.size}</div>
          <div class="stat-label">Total Orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-clock"></i></div>
          <div class="stat-number">${pendingOrders}</div>
          <div class="stat-label">Pending Orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-truck"></i></div>
          <div class="stat-number">${totalDeliveries}</div>
          <div class="stat-label">Deliveries</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
          <div class="stat-number">R${totalDeliveryFees.toFixed(2)}</div>
          <div class="stat-label">Total Delivery Fees</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-undo-alt" style="color:var(--orange);"></i></div>
          <div class="stat-number" style="color:var(--orange);">${pendingRefunds}</div>
          <div class="stat-label">Pending Refunds</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-motorcycle"></i></div>
          <div class="stat-number">${approvedDrivers}</div>
          <div class="stat-label">Active Drivers</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-user-clock"></i></div>
          <div class="stat-number">${pendingDrivers}</div>
          <div class="stat-label">Pending Drivers</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
          <div class="stat-number">R${totalPaidToDrivers.toFixed(2)}</div>
          <div class="stat-label">Paid to Drivers</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-store"></i></div>
          <div class="stat-number">${storesSnap.size}</div>
          <div class="stat-label">Total Stores</div>
        </div>
      </div>
      <div style="display:flex;gap:0.8rem;flex-wrap:wrap;margin-bottom:1.5rem;">
        <button class="btn-primary" onclick="document.querySelector('[data-section=\\'orders\\']').click();" style="font-size:0.85rem;">
          <i class="fas fa-shopping-bag"></i> View Orders
        </button>
        <button class="btn-primary" onclick="document.querySelector('[data-section=\\'refunds\\']').click();" style="font-size:0.85rem;">
          <i class="fas fa-undo-alt"></i> View Refunds
        </button>
        <button class="btn-primary" onclick="document.querySelector('[data-section=\\'drivers\\']').click();" style="font-size:0.85rem;">
          <i class="fas fa-motorcycle"></i> Approve Drivers
        </button>
        <button class="btn-primary" onclick="document.querySelector('[data-section=\\'analytics\\']').click();" style="font-size:0.85rem;">
          <i class="fas fa-chart-line"></i> View Analytics
        </button>
      </div>
      <div style="text-align:center;color:var(--text-secondary);font-size:0.9rem;padding:0.5rem;">
        <i class="fas fa-sync-alt fa-spin"></i> Live updates enabled
      </div>
    `;

    // Real-time online count
    onSnapshot(onlineQuery, (snapshot) => {
      const el = document.getElementById('dashboardOnlineCount');
      if (el) el.textContent = snapshot.size;
    });

    document.getElementById('orderBadge').textContent = pendingOrders;
    document.getElementById('driverBadge').textContent = pendingDrivers;
    document.getElementById('refundBadge').textContent = pendingRefunds;

  } catch (error) {
    console.error('Error loading dashboard:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading dashboard. Please refresh.</p>`;
  }
}

// ============================================================
//  ANALYTICS (fixed abandoned carts, store earnings exclude delivery)
// ============================================================
async function loadAnalytics() {
  showLoading();
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // ---- Product Views ----
    const viewsQuery = query(
      collection(db, 'analytics_product_views'),
      where('timestamp', '>', thirtyDaysAgo),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const viewsSnap = await getDocs(viewsQuery);
    const productViews = viewsSnap.docs.map(doc => doc.data());

    const productCount = {};
    productViews.forEach(view => {
      const key = view.productId || view.productName || 'Unknown';
      if (!productCount[key]) {
        productCount[key] = { 
          name: view.productName || 'Unknown', 
          store: view.storeName || 'Unknown', 
          count: 0,
          isSpecial: view.isSpecial || false
        };
      }
      productCount[key].count++;
    });
    const topProducts = Object.values(productCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ---- Store Views ----
    const storeViewsQuery = query(
      collection(db, 'analytics_store_views'),
      where('timestamp', '>', thirtyDaysAgo)
    );
    const storeViewsSnap = await getDocs(storeViewsQuery);
    const storeViews = storeViewsSnap.docs.map(doc => doc.data());

    const storeCount = {};
    storeViews.forEach(view => {
      const storeName = view.storeName || 'Unknown';
      if (!storeCount[storeName]) {
        storeCount[storeName] = { name: storeName, count: 0 };
      }
      storeCount[storeName].count++;
    });
    const topStores = Object.values(storeCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ---- Flyer Views ----
    const flyerViewsQuery = query(
      collection(db, 'analytics_flyer_views'),
      where('timestamp', '>', thirtyDaysAgo)
    );
    const flyerViewsSnap = await getDocs(flyerViewsQuery);
    const flyerViews = flyerViewsSnap.docs.map(doc => doc.data());
    const flyerCount = {};
    flyerViews.forEach(view => {
      const key = view.flyerId || 'Unknown';
      if (!flyerCount[key]) {
        flyerCount[key] = { name: view.flyerId || 'Unknown', store: view.storeName || 'Unknown', count: 0 };
      }
      flyerCount[key].count++;
    });
    const topFlyers = Object.values(flyerCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // ---- Special Views ----
    const specialViewsQuery = query(
      collection(db, 'analytics_special_views'),
      where('timestamp', '>', thirtyDaysAgo)
    );
    const specialViewsSnap = await getDocs(specialViewsQuery);
    const specialViews = specialViewsSnap.docs.map(doc => doc.data());
    const specialCount = {};
    specialViews.forEach(view => {
      const key = view.specialId || view.specialName || 'Unknown';
      if (!specialCount[key]) {
        specialCount[key] = { name: view.specialName || 'Unknown', store: view.storeName || 'Unknown', count: 0 };
      }
      specialCount[key].count++;
    });
    const topSpecials = Object.values(specialCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ---- Fix: Abandoned Carts (logged-in users only, exclude completed orders) ----
    const abandonedQuery = query(
      collection(db, 'abandoned_carts'),
      where('status', '==', 'abandoned'),
      where('abandonedAt', '>', thirtyDaysAgo)
    );
    const abandonedSnap = await getDocs(abandonedQuery);
    
    // Get completed orders to exclude those users
    const completedOrdersQuery = query(
      collection(db, 'orders'),
      where('orderStatus', 'in', ['delivered', 'completed'])
    );
    const completedOrdersSnap = await getDocs(completedOrdersQuery);
    const completedUserIds = new Set();
    completedOrdersSnap.forEach(doc => {
      const order = doc.data();
      if (order.customerId) completedUserIds.add(order.customerId);
    });

    // Filter abandoned carts: only logged-in users who haven't completed an order
    const validAbandonedCarts = [];
    abandonedSnap.forEach(doc => {
      const cart = doc.data();
      if (cart.userId && !completedUserIds.has(cart.userId)) {
        validAbandonedCarts.push({ id: doc.id, ...cart });
      }
    });
    const abandonedCount = validAbandonedCarts.length;

    // ---- Store Earnings (EXCLUDING delivery fees) ----
    const ordersSnap = await getDocs(collection(db, 'orders'));
    const storeEarnings = {};
    const storeSales = {};
    let totalEarnings = 0;
    let totalDeliveries = 0;

    ordersSnap.forEach(doc => {
      const order = doc.data();
      if (order.orderStatus !== 'delivered') return;
      const store = order.store || 'Unknown Store';
      const subtotal = order.subtotal || 0; // subtotal excludes delivery
      if (!storeEarnings[store]) storeEarnings[store] = 0;
      storeEarnings[store] += subtotal;
      storeSales[store] = (storeSales[store] || 0) + (order.items ? order.items.length : 0);
      totalEarnings += (order.total || 0);
      totalDeliveries++;
    });

    const sortedEarnings = Object.entries(storeEarnings)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // ---- Top Items Sold with special indicator ----
    const storeItems = {};
    ordersSnap.forEach(doc => {
      const order = doc.data();
      if (order.orderStatus !== 'delivered') return;
      if (order.items) {
        order.items.forEach(item => {
          const key = `${order.store}|${item.name}`;
          if (!storeItems[key]) {
            storeItems[key] = { 
              store: order.store, 
              name: item.name, 
              quantity: 0,
              isSpecial: item.isSpecial || false
            };
          }
          storeItems[key].quantity += item.quantity;
        });
      }
    });
    const topItems = Object.values(storeItems)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // ---- Render ----
    adminContent.innerHTML = `
      <div class="stats-grid compact analytics-stats">
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-shopping-cart"></i></div>
          <div class="stat-number">${abandonedCount}</div>
          <div class="stat-label">Abandoned Carts</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-users"></i></div>
          <div class="stat-number" id="onlineCount">0</div>
          <div class="stat-label">Online Now</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
          <div class="stat-number">R${totalEarnings.toFixed(2)}</div>
          <div class="stat-label">Total Revenue</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-box"></i></div>
          <div class="stat-number">${totalDeliveries}</div>
          <div class="stat-label">Deliveries</div>
        </div>
      </div>

      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="card-header">
            <h3><i class="fas fa-trophy"></i> Top Products</h3>
            <span class="card-badge">By views</span>
          </div>
          <div class="card-body">
            ${topProducts.length ? topProducts.map((p, i) => `
              <div class="stat-row">
                <span class="label">${i+1}. ${p.name} ${p.isSpecial ? '⭐' : ''}</span>
                <span class="value">${p.count} views · ${p.store}</span>
              </div>
            `).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:0.5rem;">No product views yet.</div>'}
          </div>
        </div>

        <div class="analytics-card">
          <div class="card-header">
            <h3><i class="fas fa-store"></i> Top Stores</h3>
            <span class="card-badge">By views</span>
          </div>
          <div class="card-body">
            ${topStores.length ? topStores.map((s, i) => `
              <div class="stat-row">
                <span class="label">${i+1}. ${s.name}</span>
                <span class="value">${s.count} views</span>
              </div>
            `).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:0.5rem;">No store views yet.</div>'}
          </div>
        </div>

        <div class="analytics-card">
          <div class="card-header">
            <h3><i class="fas fa-tag"></i> Top Specials 🔥</h3>
            <span class="card-badge">By views</span>
          </div>
          <div class="card-body">
            ${topSpecials.length ? topSpecials.map((s, i) => `
              <div class="stat-row">
                <span class="label">${i+1}. ${s.name} ${i === 0 ? '🔥🔥🔥' : i === 1 ? '🔥🔥' : i === 2 ? '🔥' : ''}</span>
                <span class="value">${s.count} views · ${s.store}</span>
              </div>
            `).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:0.5rem;">No special views yet.</div>'}
          </div>
        </div>

        <div class="analytics-card">
          <div class="card-header">
            <h3><i class="fas fa-money-bill-wave"></i> Store Earnings</h3>
            <span class="card-badge">Excl. delivery</span>
          </div>
          <div class="card-body">
            ${sortedEarnings.length ? sortedEarnings.map(([store, amount], i) => `
              <div class="stat-row">
                <span class="label">${i+1}. ${store}</span>
                <span class="value">R${amount.toFixed(2)} (${storeSales[store] || 0} items)</span>
              </div>
            `).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:0.5rem;">No earnings data yet.</div>'}
          </div>
        </div>

        <div class="analytics-card">
          <div class="card-header">
            <h3><i class="fas fa-box"></i> Top Items Sold</h3>
            <span class="card-badge">By quantity</span>
          </div>
          <div class="card-body">
            ${topItems.length ? topItems.map((item, i) => `
              <div class="stat-row">
                <span class="label">${i+1}. ${item.name} ${item.isSpecial ? '⭐ Special' : ''}</span>
                <span class="value">${item.quantity} sold · ${item.store}</span>
              </div>
            `).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:0.5rem;">No sales yet.</div>'}
          </div>
        </div>

        <div class="analytics-card">
          <div class="card-header">
            <h3><i class="fas fa-image"></i> Top Flyers</h3>
            <span class="card-badge">By views</span>
          </div>
          <div class="card-body">
            ${topFlyers.length ? topFlyers.map((f, i) => `
              <div class="stat-row">
                <span class="label">${i+1}. ${f.name}</span>
                <span class="value">${f.count} views · ${f.store}</span>
              </div>
            `).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:0.5rem;">No flyer views yet.</div>'}
          </div>
        </div>
      </div>

      <div style="margin-top:1rem;display:flex;gap:0.8rem;flex-wrap:wrap;">
        <button class="btn-primary" onclick="document.querySelector('[data-section=\\'notifications\\']').click();" style="font-size:0.85rem;">
          <i class="fas fa-bell"></i> Send Notifications
        </button>
        <button class="btn-secondary" onclick="location.reload();" style="font-size:0.85rem;">
          <i class="fas fa-sync-alt"></i> Refresh Data
        </button>
      </div>
    `;

    // Real-time online users
    const fiveMinsAgo = new Date();
    fiveMinsAgo.setMinutes(fiveMinsAgo.getMinutes() - 5);
    const onlineQuery = query(
      collection(db, 'analytics_sessions'),
      where('lastActive', '>', fiveMinsAgo)
    );
    onSnapshot(onlineQuery, (snapshot) => {
      const count = snapshot.size;
      const onlineEl = document.getElementById('onlineCount');
      if (onlineEl) onlineEl.textContent = count;
    });

  } catch (error) {
    console.error('Error loading analytics:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading analytics. Please refresh.</p>`;
  }
}

// ============================================================
//  ORDERS (with packed status, archive, assigned driver phone)
// ============================================================
let ordersUnsubscribe = null;
let archivedUnsubscribe = null;
let showArchived = false;

function loadOrders() {
  showLoading();
  const ordersRef = collection(db, 'orders');
  const q = query(ordersRef, orderBy('createdAt', 'desc'));

  // Clean up old listeners
  if (ordersUnsubscribe) ordersUnsubscribe();
  if (archivedUnsubscribe) archivedUnsubscribe();

  // Live orders
  ordersUnsubscribe = onSnapshot(q, (snapshot) => {
    renderOrdersList(snapshot, 'Live Orders');
  }, (error) => {
    console.error('Error loading orders:', error);
  });

  // Archived orders (if toggle is on)
  if (showArchived) {
    const archivedRef = collection(db, 'archivedOrders');
    const archivedQ = query(archivedRef, orderBy('archivedAt', 'desc'));
    archivedUnsubscribe = onSnapshot(archivedQ, (snapshot) => {
      renderOrdersList(snapshot, 'Archived Orders', true);
    }, (error) => {
      console.error('Error loading archived orders:', error);
    });
  }
}

function renderOrdersList(snapshot, title, isArchived = false) {
  const container = document.getElementById('ordersListContainer');
  if (!container) {
    // Create container if it doesn't exist
    const existing = document.getElementById('ordersListContainer');
    if (!existing) {
      adminContent.innerHTML = `
        <div id="ordersListContainer"></div>
      `;
    }
  }

  const target = document.getElementById('ordersListContainer') || adminContent;

  if (snapshot.empty) {
    target.innerHTML = `
      <div style="text-align:center;padding:1rem;color:var(--text-secondary);">
        <p>No ${title.toLowerCase()} found.</p>
      </div>
    `;
    return;
  }

  // ---- FIX: Use getFunctions and httpsCallable ----
  const functions = getFunctions();
  const archiveFn = httpsCallable(functions, 'archiveOrders');

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>${title} (${snapshot.size})</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <select id="orderStatusFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="packing">Packing</option>
          <option value="packed">Packed</option>
          <option value="ready">Ready</option>
          <option value="assigned">Assigned</option>
          <option value="collected">Collected</option>
          <option value="on_the_way">On The Way</option>
          <option value="delivered">Delivered</option>
          <option value="refunded">Refunded</option>
        </select>
        ${!isArchived ? `
          <button class="btn-primary" id="archiveSelectedBtn" style="font-size:0.8rem;padding:0.3rem 0.8rem;">
            <i class="fas fa-archive"></i> Archive Selected
          </button>
        ` : ''}
      </div>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>${!isArchived ? '<input type="checkbox" id="selectAllOrders" />' : ''}</th>
            <th>Order #</th>
            <th>Customer</th>
            <th>Store</th>
            <th>Total</th>
            <th>Status</th>
            <th>Driver</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  let hasOrders = false;
  const statusFilter = document.getElementById('orderStatusFilter')?.value || 'all';

  snapshot.forEach(doc => {
    const order = doc.data();
    const orderId = doc.id;
    const status = order.orderStatus || 'pending';
    
    if (statusFilter !== 'all' && status !== statusFilter) return;
    
    hasOrders = true;
    const statusClass = 'status-' + status;
    const statusLabel = status.replace('_', ' ').toUpperCase();

    html += `
      <tr>
        <td>${!isArchived ? `<input type="checkbox" class="order-select" value="${orderId}" />` : ''}</td>
        <td><strong>#${orderId.slice(-6).toUpperCase()}</strong></td>
        <td>${order.customerName || order.customerPhone || 'N/A'}</td>
        <td>${order.store || 'N/A'}</td>
        <td>R${(order.total || 0).toFixed(2)}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>${order.driverName || 'Unassigned'}</td>
        <td>
          <button class="btn-sm btn-view" onclick="viewOrder('${orderId}')"><i class="fas fa-eye"></i></button>
          ${!isArchived ? `
            <button class="btn-sm btn-edit" onclick="updateOrderStatus('${orderId}')"><i class="fas fa-pen"></i></button>
            ${(!order.driverId && (status === 'packed' || status === 'ready')) ? `<button class="btn-sm btn-approve" data-orderid="${orderId}" style="background:#17a2b8;color:#fff;">Assign</button>` : ''}
            ${(status !== 'refunded' && status !== 'delivered') ? `<button class="btn-sm btn-refund" onclick="refundOrder('${orderId}')"><i class="fas fa-undo"></i></button>` : ''}
          ` : ''}
        </td>
      </tr>
    `;
  });

  if (!hasOrders) {
    html += `<tr><td colspan="8" style="text-align:center;padding:1rem;color:var(--text-secondary);">No orders with this status.</td></tr>`;
  }

  html += `</tbody></table></div>`;
  
  // If this is the first render, set the container
  if (!document.getElementById('ordersListContainer')) {
    adminContent.innerHTML = `<div id="ordersListContainer">${html}</div>`;
  } else {
    document.getElementById('ordersListContainer').innerHTML = html;
  }

  // Event listeners
  document.getElementById('orderStatusFilter')?.addEventListener('change', loadOrders);
  document.getElementById('selectAllOrders')?.addEventListener('change', function() {
    document.querySelectorAll('.order-select').forEach(cb => cb.checked = this.checked);
  });
  
  document.getElementById('archiveSelectedBtn')?.addEventListener('click', async () => {
    const selected = document.querySelectorAll('.order-select:checked');
    if (selected.length === 0) {
      showToast('Please select orders to archive.');
      return;
    }
    if (!confirm(`Archive ${selected.length} order(s)? This will move them to the archive.`)) return;
    
    const orderIds = Array.from(selected).map(cb => cb.value);
    try {
      const result = await archiveFn({ orderIds });
      if (result.data.success) {
        showToast(`✅ ${result.data.count} orders archived.`);
        loadOrders();
      }
    } catch (error) {
      console.error('Archive error:', error);
      showToast('❌ Failed to archive orders.');
    }
  });

  // Assign driver buttons
  document.querySelectorAll('.btn-sm.btn-approve[data-orderid]').forEach(btn => {
    btn.addEventListener('click', function() {
      const orderId = this.dataset.orderid;
      assignDriver(orderId);
    });
  });
}

// ============================================================
//  REFUNDS (with credit notes, mark as paid, communicate)
// ============================================================
function loadRefunds() {
  showLoading();
  const refundsRef = collection(db, 'refundRequests');
  const q = query(refundsRef, orderBy('createdAt', 'desc'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      adminContent.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem;">No refund requests found.</p>`;
      return;
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>Refund Requests</h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <select id="refundFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="completed">Completed</option>
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
    const filter = document.getElementById('refundFilter')?.value || 'all';

    snapshot.forEach(doc => {
      const refund = doc.data();
      const refundId = doc.id;
      const status = refund.status || 'pending';
      
      if (filter !== 'all' && status !== filter) return;
      
      hasRefunds = true;
      const statusClass = 'status-' + status;
      const statusLabel = status.toUpperCase();
      const date = refund.createdAt ? refund.createdAt.toDate() : new Date();
      const phone = refund.userPhone || 'N/A';
      const userName = refund.userName || 'Unknown';

      html += `
        <tr>
          <td><strong>${userName}</strong></td>
          <td>
            ${phone}
            <div style="display:flex;gap:0.3rem;margin-top:0.2rem;">
              <a href="tel:${phone}" class="btn-sm" style="background:#28a745;color:#fff;padding:0.1rem 0.4rem;border-radius:4px;font-size:0.6rem;text-decoration:none;">
                <i class="fas fa-phone"></i>
              </a>
              <a href="https://wa.me/${phone.replace(/\s/g, '')}" target="_blank" class="btn-sm" style="background:#25D366;color:#fff;padding:0.1rem 0.4rem;border-radius:4px;font-size:0.6rem;text-decoration:none;">
                <i class="fab fa-whatsapp"></i>
              </a>
            </div>
          </td>
          <td>R${(refund.amount || 0).toFixed(2)}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td style="font-size:0.8rem;">${date.toLocaleDateString()}</td>
          <td>
            ${status === 'pending' ? `
              <button class="btn-sm btn-approve" onclick="processRefund('${refundId}','approved')">Approve</button>
              <button class="btn-sm btn-reject" onclick="processRefund('${refundId}','rejected')">Reject</button>
            ` : ''}
            ${status === 'approved' ? `
              <button class="btn-sm btn-approve" onclick="markRefundPaid('${refundId}')" style="background:#28a745;color:#fff;">Mark Paid</button>
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

    const pendingRefunds = snapshot.docs.filter(d => d.data().status === 'pending').length;
    document.getElementById('refundBadge').textContent = pendingRefunds;

  }, (error) => {
    console.error('Error loading refunds:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading refunds.</p>`;
  });

  unsubscribeListeners.push(unsubscribe);
}

// ===== Mark Refund as Paid =====
window.markRefundPaid = async function(refundId) {
  if (!confirm('Mark this refund as paid? This will deduct the amount from the user\'s wallet.')) return;
  
  try {
    const functions = getFunctions();
    const markPaidFn = httpsCallable(functions, 'markRefundPaid');
    const result = await markPaidFn({ refundId });
    if (result.data.success) {
      showToast('✅ Refund marked as paid!');
      loadCurrentSection();
    }
  } catch (error) {
    console.error('Error marking refund paid:', error);
    showToast('❌ Failed to mark refund as paid.');
  }
};

// ===== Credit Note Modal =====
window.openCreditNoteModal = function() {
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
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
  `;
  document.body.appendChild(modal);

  modal.querySelector('#issueCreditBtn').addEventListener('click', async () => {
    const phone = document.getElementById('creditPhone').value.trim();
    const amount = parseFloat(document.getElementById('creditAmount').value);
    const reason = document.getElementById('creditReason').value.trim();

    if (!phone) {
      showToast('Please enter a customer phone number.');
      return;
    }
    if (!amount || amount <= 0) {
      showToast('Please enter a valid amount.');
      return;
    }

    // Lookup user by phone
    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('phone', '==', phone)));
      if (usersSnap.empty) {
        showToast('No user found with that phone number.');
        return;
      }
      const userDoc = usersSnap.docs[0];
      const userId = userDoc.id;

      const functions = getFunctions();
      const issueCreditFn = httpsCallable(functions, 'issueCreditNote');
      const result = await issueCreditFn({ userId, amount, reason });
      if (result.data.success) {
        showToast(`✅ Credit note of R${amount.toFixed(2)} issued to ${phone}!`);
        modal.remove();
        loadCurrentSection();
      }
    } catch (error) {
      console.error('Error issuing credit note:', error);
      showToast('❌ Failed to issue credit note.');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

// ============================================================
//  DRIVERS (with earnings, paid button, area, order count)
// ============================================================
function loadDrivers() {
  showLoading();
  const driversRef = collection(db, 'drivers');
  const q = query(driversRef, orderBy('createdAt', 'desc'));

  const unsubscribe = onSnapshot(q, async (snapshot) => {
    if (snapshot.empty) {
      adminContent.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem;">No drivers found.</p>`;
      return;
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>All Drivers</h3>
        <div>
          <select id="driverFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
            <option value="all">All Drivers</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="away">Away</option>
            <option value="suspended">Suspended</option>
            <option value="on_delivery">On Delivery</option>
          </select>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Area</th>
              <th>Status</th>
              <th>Online</th>
              <th>Rating</th>
              <th>Earnings</th>
              <th>Unpaid</th>
              <th>Orders</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    const filterValue = document.getElementById('driverFilter')?.value || 'all';

    for (const doc of snapshot.docs) {
      const driver = doc.data();
      const driverId = doc.id;
      const isApproved = driver.approved || false;
      const isOnline = driver.isOnline || false;
      const isSuspended = driver.suspended || false;
      const rating = driver.rating || 0;
      const reviewCount = driver.reviewCount || 0;
      const ratingDisplay = rating > 0 ? `${rating} ⭐ (${reviewCount})` : 'No reviews';
      const totalEarnings = driver.totalEarnings || 0;
      const paidEarnings = driver.paidEarnings || 0;
      const unpaidEarnings = Math.max(0, totalEarnings - paidEarnings);
      
      // Check if driver is on delivery
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('driverId', '==', driverId),
        where('orderStatus', 'in', ['assigned', 'collected', 'on_the_way'])
      ));
      const activeOrders = ordersSnap.size;
      const onDelivery = activeOrders > 0;

      // Last seen for "away" status
      let statusDisplay = isApproved ? (isSuspended ? '⛔ Suspended' : '✅ Approved') : '⏳ Pending';
      let onlineDisplay = '🔴 Offline';
      if (isOnline && onDelivery) {
        onlineDisplay = '🟢 On Delivery';
      } else if (isOnline) {
        onlineDisplay = '🟢 Online';
      } else if (driver.lastSeen) {
        const lastSeen = driver.lastSeen.toDate ? driver.lastSeen.toDate() : new Date(driver.lastSeen);
        const diffMins = Math.floor((Date.now() - lastSeen) / 60000);
        if (diffMins > 10) {
          onlineDisplay = '🟡 Away';
        }
      }
      
      if (filterValue === 'approved' && !isApproved) continue;
      if (filterValue === 'pending' && isApproved) continue;
      if (filterValue === 'online' && !isOnline) continue;
      if (filterValue === 'offline' && isOnline) continue;
      if (filterValue === 'away' && onlineDisplay !== '🟡 Away') continue;
      if (filterValue === 'suspended' && !isSuspended) continue;
      if (filterValue === 'on_delivery' && !onDelivery) continue;

      html += `
        <tr>
          <td><img src="${driver.profilePhoto || 'img/placeholder.jpg'}" alt="Driver" style="width:40px;height:40px;object-fit:cover;border-radius:50%;"></td>
          <td><strong>${driver.firstName || ''} ${driver.lastName || ''}</strong></td>
          <td>${driver.phone || 'N/A'}</td>
          <td>
            ${driver.area || 'N/A'}
            <button class="btn-sm btn-edit" onclick="editDriverArea('${driverId}')" style="font-size:0.6rem;padding:0.1rem 0.3rem;">
              <i class="fas fa-pen"></i>
            </button>
          </td>
          <td>${statusDisplay}</td>
          <td>${onlineDisplay}</td>
          <td>${ratingDisplay}</td>
          <td>R${totalEarnings.toFixed(2)}</td>
          <td style="color:${unpaidEarnings > 0 ? 'var(--orange)' : 'var(--green)'};">R${unpaidEarnings.toFixed(2)}</td>
          <td>${activeOrders}</td>
          <td>
            ${!isApproved ? `<button class="btn-sm btn-approve" onclick="approveDriver('${driverId}')">Approve</button>` : ''}
            ${isApproved ? `<button class="btn-sm ${isSuspended ? 'btn-approve' : 'btn-warning'}" onclick="toggleSuspendDriver('${driverId}','${!isSuspended}')">${isSuspended ? 'Unsuspend' : 'Suspend'}</button>` : ''}
            ${isApproved && unpaidEarnings > 0 ? `<button class="btn-sm btn-approve" onclick="payDriver('${driverId}','${unpaidEarnings}')" style="background:#28a745;color:#fff;">Pay</button>` : ''}
            <button class="btn-sm btn-view" onclick="viewDriver('${driverId}')"><i class="fas fa-eye"></i></button>
            ${isApproved ? `<button class="btn-sm btn-delete" onclick="deleteDriver('${driverId}')"><i class="fas fa-trash"></i></button>` : ''}
            ${isApproved ? `<button class="btn-sm btn-edit" onclick="adjustDriverBalance('${driverId}')" style="background:#6c757d;color:#fff;">Adjust</button>` : ''}
          </td>
        </tr>
      `;
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;

    document.getElementById('driverFilter')?.addEventListener('change', loadDrivers);

  }, (error) => {
    console.error('Error loading drivers:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading drivers.</p>`;
  });

  unsubscribeListeners.push(unsubscribe);
}

// ===== Edit Driver Area =====
window.editDriverArea = function(driverId) {
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h3>Update Driver Area</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Service Area</label>
          <input type="text" id="driverAreaInput" placeholder="e.g. Verulam" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveDriverAreaBtn">Update Area</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#saveDriverAreaBtn').addEventListener('click', async () => {
    const area = document.getElementById('driverAreaInput').value.trim();
    if (!area) {
      showToast('Please enter an area.');
      return;
    }
    try {
      const functions = getFunctions();
      const updateAreaFn = httpsCallable(functions, 'updateDriverArea');
      const result = await updateAreaFn({ driverId, area });
      if (result.data.success) {
        showToast('✅ Driver area updated!');
        modal.remove();
        loadCurrentSection();
      }
    } catch (error) {
      console.error('Error updating driver area:', error);
      showToast('❌ Failed to update driver area.');
    }
  });
};

// ===== Pay Driver =====
window.payDriver = async function(driverId, amount) {
  if (!confirm(`Pay R${parseFloat(amount).toFixed(2)} to this driver?`)) return;
  
  try {
    const functions = getFunctions();
    const payDriverFn = httpsCallable(functions, 'payDriver');
    const result = await payDriverFn({ driverId, amount: parseFloat(amount) });
    if (result.data.success) {
      showToast(`✅ R${amount} paid to driver!`);
      loadCurrentSection();
    }
  } catch (error) {
    console.error('Error paying driver:', error);
    showToast('❌ Failed to pay driver.');
  }
};

// ---- ADJUST DRIVER BALANCE ----
window.adjustDriverBalance = function(driverId) {
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h3>Adjust Driver Balance</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Amount (R)</label>
          <input type="number" id="adjustAmount" placeholder="0.00" step="0.01" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="adjustType">
            <option value="add">Add to Earnings (increase unpaid)</option>
            <option value="pay">Mark as Paid (deduct from unpaid)</option>
            <option value="subtract">Subtract from Earnings</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveAdjustBtn">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#saveAdjustBtn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('adjustAmount').value);
    const type = document.getElementById('adjustType').value;
    if (!amount || amount <= 0) {
      showToast('Enter a valid amount.');
      return;
    }

    try {
      const driverRef = doc(db, 'drivers', driverId);
      const driverSnap = await getDoc(driverRef);
      if (!driverSnap.exists()) throw new Error('Driver not found');
      const driver = driverSnap.data();
      let totalEarnings = driver.totalEarnings || 0;
      let paidEarnings = driver.paidEarnings || 0;

      if (type === 'add') {
        totalEarnings += amount;
      } else if (type === 'pay') {
        paidEarnings += amount;
        if (paidEarnings > totalEarnings) paidEarnings = totalEarnings;
      } else if (type === 'subtract') {
        totalEarnings = Math.max(0, totalEarnings - amount);
        if (paidEarnings > totalEarnings) paidEarnings = totalEarnings;
      }

      await updateDoc(driverRef, {
        totalEarnings,
        paidEarnings,
        updatedAt: serverTimestamp()
      });

      showToast(`✅ Driver balance updated!`);
      modal.remove();
      loadCurrentSection();
    } catch (error) {
      console.error('Adjust balance error:', error);
      showToast('❌ Failed to adjust balance.');
    }
  });
};

// ============================================================
//  STORES (remove rating, add catalogs, temporarily closed)
// ============================================================
function loadStores() {
  showLoading();
  const storesRef = collection(db, 'stores');
  const q = query(storesRef, orderBy('name'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const stores = [];
    snapshot.forEach(doc => {
      stores.push({ id: doc.id, ...doc.data() });
    });

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>Stores</h3>
        <button class="btn-primary" style="padding:0.4rem 1.2rem;font-size:0.85rem;min-height:44px;" onclick="openStoreModal()">
          <i class="fas fa-plus"></i> Add Store
        </button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Logo</th>
              <th>Name</th>
              <th>Category</th>
              <th>Address</th>
              <th>Hours</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (stores.length === 0) {
      html += `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-secondary);">No stores found. Add your first store!</td></tr>`;
    } else {
      stores.forEach(store => {
        const isClosed = store.temporarilyClosed === true;
        html += `
          <tr>
            <td><img src="${store.logo || 'img/placeholder.jpg'}" alt="${store.name}" style="width:40px;height:40px;object-fit:cover;border-radius:50%;"></td>
            <td><strong>${store.name || 'N/A'}</strong></td>
            <td>${store.category || 'N/A'}</td>
            <td style="font-size:0.8rem;">${store.address || 'N/A'}</td>
            <td style="font-size:0.8rem;">${store.hours || 'N/A'}</td>
            <td>${isClosed ? '<span class="status-badge status-pending">🔴 Closed</span>' : '<span class="status-badge status-confirmed">🟢 Open</span>'}</td>
            <td>
              <button class="btn-sm btn-edit" onclick="editStore('${store.id}')"><i class="fas fa-pen"></i></button>
              <button class="btn-sm ${isClosed ? 'btn-approve' : 'btn-warning'}" onclick="toggleStoreClosed('${store.id}','${!isClosed}')" style="${isClosed ? '' : 'background:#FFC107;color:#030E38;'}">
                ${isClosed ? 'Open' : 'Close'}
              </button>
              <button class="btn-sm btn-delete" onclick="deleteStore('${store.id}')"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;
  }, (error) => {
    console.error('Error loading stores:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading stores.</p>`;
  });

  unsubscribeListeners.push(unsubscribe);
}

// ===== Toggle Store Closed =====
window.toggleStoreClosed = async function(storeId, close) {
  if (!confirm(`${close ? 'Close' : 'Open'} this store? ${close ? 'Customers will not be able to order.' : 'Customers will be able to order again.'}`)) return;
  try {
    await updateDoc(doc(db, 'stores', storeId), {
      temporarilyClosed: close,
      updatedAt: serverTimestamp()
    });
    showToast(`✅ Store ${close ? 'closed' : 'opened'}!`);
    loadCurrentSection();
  } catch (error) {
    console.error('Error toggling store status:', error);
    showToast('❌ Failed to update store status.');
  }
};

// ===== Store Modal (removed rating, added catalogs) =====
window.openStoreModal = function(storeData = null) {
  const isEdit = !!storeData;
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width:650px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit' : 'Add'} Store</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Store Name *</label>
          <input type="text" id="storeName" value="${storeData?.name || ''}" placeholder="e.g. Golden Gate Super" />
        </div>
        <div class="form-group">
          <label>Category *</label>
          <select id="storeCategory">
            <option value="supermarket" ${storeData?.category === 'supermarket' ? 'selected' : ''}>Supermarket</option>
            <option value="butchery" ${storeData?.category === 'butchery' ? 'selected' : ''}>Butchery</option>
            <option value="bakery" ${storeData?.category === 'bakery' ? 'selected' : ''}>Bakery</option>
            <option value="pharmacy" ${storeData?.category === 'pharmacy' ? 'selected' : ''}>Pharmacy</option>
            <option value="other" ${storeData?.category === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Store Address *</label>
          <input type="text" id="storeAddress" value="${storeData?.address || ''}" placeholder="e.g. 123 Main St, Verulam" />
        </div>
        <div class="form-group">
          <label>Phone Number *</label>
          <input type="text" id="storePhone" value="${storeData?.phone || ''}" placeholder="e.g. 031 123 4567" />
        </div>
        <div class="form-group">
          <label>WhatsApp Primary (for orders) *</label>
          <input type="text" id="storeWhatsAppPrimary" value="${storeData?.whatsappPrimary || ''}" placeholder="+27 82 123 4567" />
        </div>
        <div class="form-group">
          <label>WhatsApp Secondary (optional)</label>
          <input type="text" id="storeWhatsAppSecondary" value="${storeData?.whatsappSecondary || ''}" placeholder="+27 82 987 6543" />
        </div>
        <div class="form-group">
          <label>Logo URL</label>
          <input type="text" id="storeLogo" value="${storeData?.logo || ''}" placeholder="https://example.com/logo.jpg" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="storeDescription" rows="2" placeholder="Store description...">${storeData?.description || ''}</textarea>
        </div>
        <div class="form-group">
          <label>Hours (e.g. Mon-Sat 8am-6pm, Sun 9am-2pm)</label>
          <input type="text" id="storeHours" value="${storeData?.hours || ''}" placeholder="Mon-Sat 8am-6pm, Sun 9am-2pm" />
        </div>
        <div class="form-group">
          <label>Popular</label>
          <select id="storePopular">
            <option value="true" ${storeData?.popular === true ? 'selected' : ''}>Yes</option>
            <option value="false" ${storeData?.popular !== true ? 'selected' : ''}>No</option>
          </select>
        </div>
        <div class="form-group">
          <label>Tags (comma separated)</label>
          <input type="text" id="storeTags" value="${storeData?.tags?.join(', ') || ''}" placeholder="Grocery, Fresh, Halal" />
        </div>
        <div class="form-group">
          <label>Catalogs/Flyers (image URLs, comma separated)</label>
          <input type="text" id="storeFlyers" value="${storeData?.flyers ? storeData.flyers.map(f => f.image).join(', ') : ''}" placeholder="https://example.com/flyer1.jpg, https://example.com/flyer2.jpg" />
        </div>
        <div class="form-group">
          <label>Temporarily Closed</label>
          <select id="storeClosed">
            <option value="false" ${storeData?.temporarilyClosed !== true ? 'selected' : ''}>Open</option>
            <option value="true" ${storeData?.temporarilyClosed === true ? 'selected' : ''}>Closed</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveStoreBtn">${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#saveStoreBtn').addEventListener('click', async () => {
    const name = document.getElementById('storeName').value.trim();
    const category = document.getElementById('storeCategory').value;
    const address = document.getElementById('storeAddress').value.trim();
    const phone = document.getElementById('storePhone').value.trim();
    const whatsappPrimary = document.getElementById('storeWhatsAppPrimary').value.trim();
    const whatsappSecondary = document.getElementById('storeWhatsAppSecondary').value.trim();
    const logo = document.getElementById('storeLogo').value.trim();
    const description = document.getElementById('storeDescription').value.trim();
    const hours = document.getElementById('storeHours').value.trim();
    const popular = document.getElementById('storePopular').value === 'true';
    const tags = document.getElementById('storeTags').value.split(',').map(t => t.trim()).filter(Boolean);
    const flyerUrls = document.getElementById('storeFlyers').value.split(',').map(f => f.trim()).filter(Boolean);
    const temporarilyClosed = document.getElementById('storeClosed').value === 'true';

    if (!name || !address || !phone || !whatsappPrimary) {
      showToast('Store name, address, phone, and primary WhatsApp are required.');
      return;
    }

    // Build flyers array
    const flyers = flyerUrls.map(url => ({
      image: url,
      title: `${name} Catalog`
    }));

    const data = {
      name, category, address, phone, whatsappPrimary, whatsappSecondary: whatsappSecondary || '',
      logo: logo || 'img/placeholder.jpg', description: description || '', hours: hours || 'Mon-Sat 8am-6pm',
      popular, tags, flyers: flyers, temporarilyClosed, updatedAt: serverTimestamp()
    };

    try {
      if (isEdit) {
        await updateDoc(doc(db, 'stores', storeData.id), data);
        showToast('✅ Store updated successfully!');
      } else {
        await addDoc(collection(db, 'stores'), { ...data, createdAt: serverTimestamp() });
        showToast('✅ Store added successfully!');
      }
      modal.remove();
      loadCurrentSection();
    } catch (error) {
      console.error('Error saving store:', error);
      showToast('❌ Failed to save store.');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

// ============================================================
//  PRODUCTS (store filter, description, weight, multiple images)
// ============================================================
function loadProducts() {
  showLoading();
  const storesRef = collection(db, 'stores');
  getDocs(storesRef).then(storesSnap => {
    const stores = [];
    storesSnap.forEach(doc => {
      stores.push({ id: doc.id, name: doc.data().name || 'Unknown' });
    });

    const productsRef = collection(db, 'products');
    const q = query(productsRef, orderBy('name'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h3>Products</h3>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <select id="productStoreFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
              <option value="all">All Stores</option>
              ${stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
            <button class="btn-primary" style="padding:0.4rem 1.2rem;font-size:0.85rem;min-height:44px;" onclick="openProductModal()">
              <i class="fas fa-plus"></i> Add Product
            </button>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>Name</th>
                <th>Store</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
      `;

      if (snapshot.empty) {
        html += `<tr><td colspan="6" style="text-align:center;padding:1rem;color:var(--text-secondary);">No products found. Add your first product!</td></tr>`;
      } else {
        const filterStore = document.getElementById('productStoreFilter')?.value || 'all';
        snapshot.forEach(doc => {
          const product = doc.data();
          const productId = doc.id;
          if (filterStore !== 'all' && product.storeId !== filterStore) return;
          const storeName = stores.find(s => s.id === product.storeId)?.name || 'Unknown';
          const inStock = product.stock !== false;
          html += `
            <tr>
              <td><img src="${product.image || 'img/placeholder.jpg'}" alt="${product.name}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;"></td>
              <td><strong>${product.name || 'N/A'}</strong></td>
              <td>${storeName}</td>
              <td>R${(product.price || 0).toFixed(2)}</td>
              <td><span class="status-badge ${inStock ? 'status-confirmed' : 'status-pending'}">${inStock ? '✅ In Stock' : '❌ Out of Stock'}</span></td>
              <td>
                <button class="btn-sm btn-edit" onclick="editProduct('${productId}')"><i class="fas fa-pen"></i></button>
                <button class="btn-sm btn-delete" onclick="deleteProduct('${productId}')"><i class="fas fa-trash"></i></button>
              </td>
            </tr>
          `;
        });
      }

      html += `</tbody></table></div>`;
      adminContent.innerHTML = html;
      document.getElementById('productStoreFilter')?.addEventListener('change', loadProducts);

    }, (error) => {
      console.error('Error loading products:', error);
      adminContent.innerHTML = `<p style="color:var(--red);">Error loading products.</p>`;
    });

    unsubscribeListeners.push(unsubscribe);
  }).catch(error => {
    console.error('Error loading stores for filter:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading products.</p>`;
  });
}

// ===== Product Modal (description, weight, multiple images) =====
window.openProductModal = function(productData = null) {
  const isEdit = !!productData;
  getDocs(collection(db, 'stores')).then(storesSnap => {
    const stores = [];
    storesSnap.forEach(doc => {
      stores.push({ id: doc.id, name: doc.data().name || 'Unknown' });
    });

    const modal = document.createElement('div');
    modal.className = 'admin-modal active';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:550px;">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Add'} Product</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Product Name *</label>
            <input type="text" id="productName" value="${productData?.name || ''}" placeholder="e.g. Fresh Bread" />
          </div>
          <div class="form-group">
            <label>Store *</label>
            <select id="productStore">
              <option value="">Select Store</option>
              ${stores.map(s => `<option value="${s.id}" ${productData?.storeId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Category</label>
            <input type="text" id="productCategory" value="${productData?.category || ''}" placeholder="e.g. Bakery, Meat, Dairy" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="productDescription" rows="2" placeholder="Product description...">${productData?.desc || ''}</textarea>
          </div>
          <div class="form-group">
            <label>Weight (e.g. 500g, 1kg)</label>
            <input type="text" id="productWeight" value="${productData?.weight || ''}" placeholder="e.g. 500g" />
          </div>
          <div class="form-group">
            <label>Price (R) *</label>
            <input type="number" id="productPrice" value="${productData?.price || ''}" step="0.01" placeholder="12.99" />
          </div>
          <div class="form-group">
            <label>Old Price (R) - optional</label>
            <input type="number" id="productOldPrice" value="${productData?.oldPrice || ''}" step="0.01" placeholder="21.00" />
          </div>
          <div class="form-group">
            <label>Main Image URL</label>
            <input type="text" id="productImage" value="${productData?.image || ''}" placeholder="https://example.com/image.jpg" />
          </div>
          <div class="form-group">
            <label>Additional Images (URLs, comma separated)</label>
            <input type="text" id="productImages" value="${productData?.images ? productData.images.join(', ') : ''}" placeholder="https://example.com/img1.jpg, https://example.com/img2.jpg" />
          </div>
          <div class="form-group">
            <label>Stock</label>
            <select id="productStock">
              <option value="true" ${productData?.stock !== false ? 'selected' : ''}>In Stock</option>
              <option value="false" ${productData?.stock === false ? 'selected' : ''}>Out of Stock</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
          <button class="btn-save" id="saveProductBtn">${isEdit ? 'Update' : 'Save'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#saveProductBtn').addEventListener('click', async () => {
      const name = document.getElementById('productName').value.trim();
      const storeId = document.getElementById('productStore').value;
      const category = document.getElementById('productCategory').value.trim();
      const desc = document.getElementById('productDescription').value.trim();
      const weight = document.getElementById('productWeight').value.trim();
      const price = parseFloat(document.getElementById('productPrice').value);
      const oldPrice = parseFloat(document.getElementById('productOldPrice').value) || null;
      const image = document.getElementById('productImage').value.trim();
      const images = document.getElementById('productImages').value.split(',').map(s => s.trim()).filter(Boolean);
      const stock = document.getElementById('productStock').value === 'true';

      if (!name || !storeId || isNaN(price) || price <= 0) {
        showToast('Please fill in all required fields.');
        return;
      }

      const data = {
        name, storeId, category: category || 'Uncategorized', desc, weight,
        price, oldPrice,
        image: image || 'img/placeholder.jpg',
        images: images,
        stock, updatedAt: serverTimestamp()
      };

      try {
        if (isEdit) {
          await updateDoc(doc(db, 'products', productData.id), data);
          showToast('✅ Product updated successfully!');
        } else {
          await addDoc(collection(db, 'products'), { ...data, createdAt: serverTimestamp() });
          showToast('✅ Product added successfully!');
        }
        modal.remove();
        loadCurrentSection();
      } catch (error) {
        console.error('Error saving product:', error);
        showToast('❌ Failed to save product.');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }).catch(error => {
    console.error('Error loading stores:', error);
    showToast('Error loading stores.');
  });
};

// ============================================================
//  SPECIALS (pulse for 3-day, flame for top 3)
// ============================================================
function loadSpecials() {
  showLoading();
  const specialsRef = collection(db, 'specials');
  const q = query(specialsRef, orderBy('createdAt', 'desc'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    // Get special views to determine popularity
    getDocs(collection(db, 'analytics_special_views')).then(viewsSnap => {
      const viewCounts = {};
      viewsSnap.forEach(doc => {
        const data = doc.data();
        const key = data.specialId || data.specialName || 'unknown';
        viewCounts[key] = (viewCounts[key] || 0) + 1;
      });

      // Sort specials by view count for top 3
      const sortedIds = Object.keys(viewCounts).sort((a, b) => viewCounts[b] - viewCounts[a]);

      let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <h3>Weekly Specials</h3>
          <button class="btn-primary" style="padding:0.4rem 1.2rem;font-size:0.85rem;min-height:44px;" onclick="openSpecialModal()">
            <i class="fas fa-plus"></i> Add Special
          </button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Store</th>
                <th>Price</th>
                <th>Tag</th>
                <th>Popularity</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
      `;

      if (snapshot.empty) {
        html += `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-secondary);">No specials found. Add your first special!</td></tr>`;
      } else {
        // Sort by view count for popularity
        const specials = [];
        snapshot.forEach(doc => {
          const special = doc.data();
          const specialId = doc.id;
          const views = viewCounts[specialId] || viewCounts[special.item] || 0;
          specials.push({ id: specialId, ...special, views });
        });
        specials.sort((a, b) => b.views - a.views);

        specials.forEach((special, index) => {
          const specialId = special.id;
          const isActive = special.active !== false;
          const statusClass = isActive ? 'status-confirmed' : 'status-pending';
          
          // Check if ending soon (3 days or less)
          let endingSoon = false;
          let flameEmoji = '';
          if (special.endDate) {
            const endDate = special.endDate.toDate ? special.endDate.toDate() : new Date(special.endDate);
            const now = new Date();
            const diffDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
            endingSoon = diffDays <= 3 && diffDays >= 0;
            
            // Top 3 flame emojis
            if (index === 0) flameEmoji = '🔥🔥🔥';
            else if (index === 1) flameEmoji = '🔥🔥';
            else if (index === 2) flameEmoji = '🔥';
          }

          html += `
            <tr>
              <td><strong>${special.item || 'N/A'} ${flameEmoji}</strong></td>
              <td>${special.store || 'N/A'}</td>
              <td>R${(special.price || 0).toFixed(2)}</td>
              <td><span class="status-badge" style="background:var(--orange);color:#fff;">${special.tag || 'N/A'}</span></td>
              <td>${special.views || 0} views${endingSoon ? ' ⏰ Ending soon!' : ''}</td>
              <td><span class="status-badge ${statusClass}">${isActive ? '✅ Active' : '❌ Inactive'}</span></td>
              <td>
                <button class="btn-sm btn-edit" onclick="editSpecial('${specialId}')"><i class="fas fa-pen"></i></button>
                <button class="btn-sm btn-delete" onclick="deleteSpecial('${specialId}')"><i class="fas fa-trash"></i></button>
              </td>
            </tr>
          `;
        });
      }

      html += `</tbody></table></div>`;
      adminContent.innerHTML = html;
    });
  }, (error) => {
    console.error('Error loading specials:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading specials.</p>`;
  });

  unsubscribeListeners.push(unsubscribe);
}

// ============================================================
//  AREAS
// ============================================================
function loadAreas() {
  showLoading();
  const areasRef = collection(db, 'areas');

  const unsubscribe = onSnapshot(areasRef, (snapshot) => {
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>Delivery Areas</h3>
        <button class="btn-primary" style="padding:0.4rem 1.2rem;font-size:0.85rem;min-height:44px;" onclick="openAreaModal()">
          <i class="fas fa-plus"></i> Add Area
        </button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Area Name</th>
              <th>Status</th>
              <th>Delivery Fee</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (snapshot.empty) {
      html += `<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--text-secondary);">No areas defined. Add your first delivery area!</td></tr>`;
    } else {
      snapshot.forEach(doc => {
        const area = doc.data();
        html += `
          <tr>
            <td><strong>${area.name || 'N/A'}</strong></td>
            <td><span class="status-badge ${area.active !== false ? 'status-confirmed' : 'status-pending'}">${area.active !== false ? '✅ Active' : '❌ Inactive'}</span></td>
            <td>R${(area.fee || 35).toFixed(2)}</td>
            <td>
              <button class="btn-sm btn-edit" onclick="editArea('${doc.id}')"><i class="fas fa-pen"></i></button>
              <button class="btn-sm btn-delete" onclick="deleteArea('${doc.id}')"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;
  }, (error) => {
    console.error('Error loading areas:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading areas.</p>`;
  });

  unsubscribeListeners.push(unsubscribe);
}

// ============================================================
//  STORE NOTIFICATIONS (status changes to sent, delete option)
// ============================================================
function loadStoreNotifications() {
  showLoading();
  
  const notifRef = collection(db, 'storeNotifications');
  const q = query(notifRef, orderBy('createdAt', 'desc'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
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
        <tr data-notifid="${notifId}" data-primary="${primary}" data-secondary="${secondary}" data-message="${message.replace(/"/g, '&quot;')}">
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

  unsubscribeListeners.push(unsubscribe);
}

// ===== Send Store WhatsApp (mark as sent) =====
window.sendStoreWhatsApp = async function(notifId, phone, message) {
  if (!phone || phone === 'N/A') {
    showToast('No phone number available.');
    return;
  }

  const formattedPhone = phone.replace(/\s/g, '');
  const encodedMessage = encodeURIComponent(message);
  const waUrl = `https://wa.me/${formattedPhone}?text=${encodedMessage}`;

  window.open(waUrl, '_blank');

  try {
    // Mark as sent
    await updateDoc(doc(db, 'storeNotifications', notifId), {
      sent: true,
      sentAt: serverTimestamp()
    });
    showToast('✅ Notification marked as sent!');
    // Refresh the list
    loadStoreNotifications();
  } catch (error) {
    console.error('Error marking notification as sent:', error);
  }
};

// ===== Delete Store Notification =====
window.deleteStoreNotification = async function(notifId) {
  try {
    await deleteDoc(doc(db, 'storeNotifications', notifId));
    showToast('🗑️ Notification deleted.');
    loadStoreNotifications();
  } catch (error) {
    console.error('Error deleting notification:', error);
    showToast('❌ Failed to delete notification.');
  }
};

// ============================================================
//  VIEW STORE NOTIFICATION (full message)
// ============================================================
window.viewStoreNotif = async function(notifId) {
  try {
    const docRef = doc(db, 'storeNotifications', notifId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Notification not found.');
      return;
    }
    const notif = docSnap.data();

    const modal = document.createElement('div');
    modal.className = 'admin-modal active';
    modal.innerHTML = `
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
          <p><strong>Created:</strong> ${notif.createdAt ? notif.createdAt.toDate().toLocaleString() : 'N/A'}</p>
          <hr style="margin:0.5rem 0;border-color:var(--border);">
          <h4>Message</h4>
          <div style="background:var(--bg);padding:0.8rem;border-radius:8px;white-space:pre-wrap;font-size:0.85rem;border:1px solid var(--border);max-height:300px;overflow-y:auto;">
            ${notif.message || 'No message'}
          </div>
          <hr style="margin:0.5rem 0;border-color:var(--border);">
          <h4>Acceptance Link</h4>
          <div style="background:var(--bg);padding:0.8rem;border-radius:8px;font-size:0.8rem;word-break:break-all;border:1px solid var(--border);">
            <a href="${notif.acceptUrl || '#'}" target="_blank">${notif.acceptUrl || 'No link'}</a>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Error viewing notification:', error);
    showToast('Error loading notification details.');
  }
};

// ============================================================
//  NOTIFICATIONS (send push)
// ============================================================
function loadNotifications() {
  showLoading();
  
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
          const date = notif.sentAt ? notif.sentAt.toDate() : new Date();
          historyHtml += `
            <div style="padding:0.5rem;border-bottom:1px solid var(--border);font-size:0.85rem;">
              <div style="display:flex;justify-content:space-between;">
                <span><strong>${notif.title || 'Notification'}</strong></span>
                <span style="font-size:0.7rem;color:var(--text-muted);">${date.toLocaleString()}</span>
              </div>
              <div style="color:var(--text-secondary);">${notif.message || ''}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);">Sent to: ${notif.recipients || 'All customers'} (${notif.recipientCount || 0})</div>
            </div>
          `;
        });
      }

      // Get abandoned carts for targeting
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
                      `${cart.userName} (R${cart.subtotal.toFixed(2)})`
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
                        <input type="checkbox" class="user-checkbox" value="${u.id}" /> ${u.name} (${u.phone || 'no phone'})
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
                          <input type="checkbox" class="abandoned-user-checkbox" value="${cart.userId}" checked /> ${user ? user.name : cart.userName} (${cart.userPhone || 'no phone'})
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

          let recipientList = [];
          if (recipients === 'specific') {
            const checkboxes = document.querySelectorAll('.user-checkbox:checked');
            checkboxes.forEach(cb => {
              const user = users.find(u => u.id === cb.value);
              if (user) recipientList.push(user);
            });
            if (recipientList.length === 0) {
              showToast('Please select at least one customer.');
              return;
            }
          } else if (recipients === 'abandoned') {
            const checkboxes = document.querySelectorAll('.abandoned-user-checkbox:checked');
            checkboxes.forEach(cb => {
              const user = users.find(u => u.id === cb.value);
              if (user) recipientList.push(user);
            });
            if (recipientList.length === 0) {
              showToast('No abandoned cart users selected.');
              return;
            }
          }

          try {
            const functions = getFunctions();
            const sendPushFn = httpsCallable(functions, 'sendPushNotification');
            
            const userIds = recipients === 'all' ? [] : recipientList.map(u => u.id);
            const result = await sendPushFn({
              userIds: userIds,
              title: title,
              body: message,
              data: { type: 'admin_notification' }
            });

            if (result.data.success) {
              showToast(`✅ Notification sent to ${result.data.recipients} users!`);
              document.getElementById('notifTitle').value = '';
              document.getElementById('notifMessage').value = '';
              loadCurrentSection();
            } else {
              showToast('⚠️ ' + (result.data.message || 'Failed to send notification.'));
            }
          } catch (error) {
            console.error('Error sending notification:', error);
            showToast('❌ Failed to send notification.');
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
//  TEST MODE
// ============================================================
function loadTestMode() {
  const settingsRef = doc(db, 'settings', 'testMode');
  
  getDoc(settingsRef).then((docSnap) => {
    const isEnabled = docSnap.exists() ? docSnap.data().enabled : false;
    
    adminContent.innerHTML = `
      <div class="settings-section">
        <h3 style="margin-bottom:1rem;"><i class="fas fa-vial"></i> Test Mode</h3>
        
        ${isEnabled ? `
          <div class="test-mode-banner">
            <div class="banner-icon"><i class="fas fa-flask"></i></div>
            <div class="banner-text">
              <h4>⚠️ Test Mode is ACTIVE</h4>
              <p>Yoco test keys are being used. Orders will bypass real payments.</p>
              <p style="font-size:0.8rem;margin-top:0.3rem;">Test key: sk_test_7669b252K178Y7adb5b418cafdf4</p>
            </div>
            <span class="banner-status active">🔴 Active</span>
          </div>
        ` : `
          <div class="test-mode-banner" style="background:#F0FDF4;border-color:var(--green);">
            <div class="banner-icon"><i class="fas fa-check-circle" style="color:var(--green);"></i></div>
            <div class="banner-text">
              <h4>Test Mode is OFF</h4>
              <p>Yoco LIVE keys are being used. All orders will process real payments.</p>
              <p style="font-size:0.8rem;margin-top:0.3rem;">Live key: sk_live_**** (not shown)</p>
            </div>
            <span class="banner-status inactive">🟢 Live</span>
          </div>
        `}
        
        <div class="settings-card" style="margin-top:1rem;">
          <div class="form-group">
            <label>Test Mode Status</label>
            <div class="toggle-switch">
              <div class="toggle-track ${isEnabled ? 'active' : ''}" id="testModeToggle">
                <div class="toggle-thumb"></div>
              </div>
              <span class="toggle-label">${isEnabled ? 'Test Mode ON' : 'Test Mode OFF'}</span>
            </div>
            <p class="toggle-hint">
              ${isEnabled 
                ? '🔴 Test mode is active. All orders will bypass Yoco payment.' 
                : '🟢 Test mode is off. All orders will process real payments through Yoco.'}
            </p>
          </div>
          <button class="btn-save" id="saveTestModeBtn">
            <i class="fas fa-save"></i> ${isEnabled ? 'Disable Test Mode' : 'Enable Test Mode'}
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('testModeToggle')?.addEventListener('click', () => {
      document.getElementById('testModeToggle').classList.toggle('active');
      const newState = document.getElementById('testModeToggle').classList.contains('active');
      const label = document.querySelector('.toggle-label');
      if (label) label.textContent = newState ? 'Test Mode ON' : 'Test Mode OFF';
      const hint = document.querySelector('.toggle-hint');
      if (hint) {
        hint.textContent = newState 
          ? '🔴 Test mode is active. All orders will bypass Yoco payment.' 
          : '🟢 Test mode is off. All orders will process real payments through Yoco.';
      }
      document.getElementById('saveTestModeBtn').textContent = newState ? 'Disable Test Mode' : 'Enable Test Mode';
    });
    
    document.getElementById('saveTestModeBtn')?.addEventListener('click', async () => {
      const isActive = document.getElementById('testModeToggle').classList.contains('active');
      try {
        await setDoc(doc(db, 'settings', 'testMode'), { 
          enabled: isActive, 
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid || 'admin'
        }, { merge: true });
        showToast(`✅ Test mode ${isActive ? 'enabled' : 'disabled'} successfully!`);
        loadCurrentSection();
      } catch (error) {
        console.error('Error saving test mode:', error);
        showToast('❌ Failed to save test mode setting.');
      }
    });
    
  }).catch(error => {
    console.error('Error loading test mode:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading test mode settings.</p>`;
  });
}

// ============================================================
//  SETTINGS
// ============================================================
function loadSettings() {
  const settingsRef = doc(db, 'settings', 'delivery');
  Promise.all([
    getDoc(settingsRef),
    getDocs(collection(db, 'stores'))
  ]).then(([settingsDoc, storesSnap]) => {
    const fee = settingsDoc.exists() ? settingsDoc.data().fee : 35;
    adminContent.innerHTML = `
      <div class="settings-section">
        <h3 style="margin-bottom:1rem;">Settings</h3>
        <div class="settings-card">
          <div class="form-group">
            <label for="deliveryFeeInput">Delivery Fee (R)</label>
            <input type="number" id="deliveryFeeInput" value="${fee}" step="0.50" min="0" />
            <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem;">This fee is charged to customers per delivery. Updates will reflect on checkout and cart.</p>
          </div>
          <button class="btn-save" id="saveSettingsBtn"><i class="fas fa-save"></i> Save Settings</button>
        </div>
      </div>
    `;
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      const fee = parseFloat(document.getElementById('deliveryFeeInput').value);
      if (isNaN(fee) || fee < 0) {
        showToast('Please enter a valid amount.');
        return;
      }
      try {
        await setDoc(doc(db, 'settings', 'delivery'), { fee, updatedAt: serverTimestamp() }, { merge: true });
        showToast('✅ Delivery fee updated successfully!');
        loadCurrentSection();
      } catch (error) {
        console.error('Error saving settings:', error);
        showToast('❌ Failed to save settings.');
      }
    });
  }).catch(error => {
    console.error('Error loading settings:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading settings.</p>`;
  });
}

// ============================================================
//  COMMON FUNCTIONS (view/update/delete for various entities)
// ============================================================

// ---- APPROVE DRIVER ----
window.approveDriver = async function(driverId) {
  try {
    await updateDoc(doc(db, 'drivers', driverId), { approved: true, updatedAt: serverTimestamp() });
    showToast('✅ Driver approved successfully!');
    loadCurrentSection();
  } catch (error) {
    console.error('Error approving driver:', error);
    showToast('❌ Failed to approve driver.');
  }
};

// ---- TOGGLE SUSPEND DRIVER ----
window.toggleSuspendDriver = async function(driverId, suspend) {
  if (!confirm(`Are you sure you want to ${suspend ? 'suspend' : 'unsuspend'} this driver?`)) return;
  try {
    await updateDoc(doc(db, 'drivers', driverId), { suspended: suspend, updatedAt: serverTimestamp() });
    showToast(`✅ Driver ${suspend ? 'suspended' : 'unsuspended'} successfully!`);
    loadCurrentSection();
  } catch (error) {
    console.error('Error toggling suspension:', error);
    showToast('❌ Failed to update driver status.');
  }
};

// ---- DELETE DRIVER ----
window.deleteDriver = async function(driverId) {
  if (!confirm('Are you sure you want to delete this driver? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'drivers', driverId));
    showToast('✅ Driver deleted successfully!');
    loadCurrentSection();
  } catch (error) {
    console.error('Error deleting driver:', error);
    showToast('❌ Failed to delete driver.');
  }
};

// ---- VIEW DRIVER ----
window.viewDriver = async function(driverId) {
  try {
    const docRef = doc(db, 'drivers', driverId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Driver not found.');
      return;
    }
    const driver = docSnap.data();

    // Get active order count
    const ordersSnap = await getDocs(query(
      collection(db, 'orders'),
      where('driverId', '==', driverId),
      where('orderStatus', 'in', ['assigned', 'collected', 'on_the_way'])
    ));
    const activeOrders = ordersSnap.size;

    const modal = document.createElement('div');
    modal.className = 'admin-modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Driver Details</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
          ${driver.profilePhoto ? `<img src="${driver.profilePhoto}" alt="Profile" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 0.5rem;display:block;cursor:pointer;" onclick="window.open('${driver.profilePhoto}','_blank');">` : ''}
          ${driver.vehiclePhoto ? `<img src="${driver.vehiclePhoto}" alt="Vehicle" style="width:80px;height:80px;border-radius:8px;object-fit:cover;margin:0 0.3rem 0.5rem;cursor:pointer;" onclick="window.open('${driver.vehiclePhoto}','_blank');">` : ''}
          ${driver.licensePhoto ? `<img src="${driver.licensePhoto}" alt="License" style="width:80px;height:80px;border-radius:8px;object-fit:cover;margin:0 0.3rem 0.5rem;cursor:pointer;" onclick="window.open('${driver.licensePhoto}','_blank');">` : ''}
          <p><strong>Name:</strong> ${driver.firstName || ''} ${driver.lastName || ''}</p>
          <p><strong>Phone:</strong> ${driver.phone || 'N/A'}</p>
          <p><strong>Email:</strong> ${driver.email || 'N/A'}</p>
          <p><strong>Vehicle Reg:</strong> ${driver.vehicleReg || 'N/A'}</p>
          <p><strong>Area:</strong> ${driver.area || 'N/A'}</p>
          <p><strong>Status:</strong> ${driver.approved ? (driver.suspended ? '⛔ Suspended' : '✅ Approved') : '⏳ Pending'}</p>
          <p><strong>Online:</strong> ${driver.isOnline ? '🟢 Online' : '🔴 Offline'}</p>
          <p><strong>Active Orders:</strong> ${activeOrders}</p>
          <p><strong>Rating:</strong> ${driver.rating || 0} ⭐ (${driver.reviewCount || 0} reviews)</p>
          <p><strong>Total Earnings:</strong> R${(driver.totalEarnings || 0).toFixed(2)}</p>
          <p><strong>Paid Earnings:</strong> R${(driver.paidEarnings || 0).toFixed(2)}</p>
          <p><strong>Unpaid:</strong> R${Math.max(0, (driver.totalEarnings || 0) - (driver.paidEarnings || 0)).toFixed(2)}</p>
          <p><strong>Delivery Fee:</strong> R${(driver.deliveryFee || 20).toFixed(2)}</p>
          <hr style="margin:0.5rem 0;border-color:var(--border);">
          <h4>Bank Details</h4>
          <p><strong>Bank:</strong> ${driver.bankName || 'N/A'}</p>
          <p><strong>Account Holder:</strong> ${driver.bankAccountName || 'N/A'}</p>
          <p><strong>Account Number:</strong> ${driver.bankAccountNumber ? '••••' + driver.bankAccountNumber.slice(-4) : 'N/A'}</p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Error viewing driver:', error);
    showToast('Error loading driver details.');
  }
};

// ---- REFUND ORDER ----
window.refundOrder = async function(orderId) {
  if (!confirm('Are you sure you want to refund this order? This will process a refund via Yoco.')) return;
  
  try {
    showToast('Processing refund...');
    const orderDoc = await getDoc(doc(db, 'orders', orderId));
    if (!orderDoc.exists()) {
      showToast('Order not found.');
      return;
    }
    const order = orderDoc.data();
    
    await addDoc(collection(db, 'refundRequests'), {
      orderId: orderId,
      userId: order.customerId || '',
      userName: order.customerName || 'Unknown',
      userPhone: order.customerPhone || '',
      amount: order.total || 0,
      status: 'pending',
      message: `Refund request for order #${orderId.slice(-6).toUpperCase()}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    showToast('✅ Refund request created! Admin will process it.');
    loadCurrentSection();
  } catch (error) {
    console.error('Error creating refund:', error);
    showToast('❌ Failed to create refund request.');
  }
};

// ---- PROCESS REFUND ----
window.processRefund = async function(refundId, status) {
  if (!confirm(`Are you sure you want to ${status} this refund request?`)) return;
  
  try {
    await updateDoc(doc(db, 'refundRequests', refundId), {
      status: status,
      processedAt: serverTimestamp(),
      processedBy: currentUser?.uid || 'admin'
    });
    
    if (status === 'approved') {
      const refundDoc = await getDoc(doc(db, 'refundRequests', refundId));
      if (refundDoc.exists()) {
        const refund = refundDoc.data();
        const userRef = doc(db, 'users', refund.userId);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          const currentBalance = userDoc.data().walletBalance || 0;
          await updateDoc(userRef, {
            walletBalance: currentBalance + (refund.amount || 0),
            updatedAt: serverTimestamp()
          });
        }
      }
    }
    
    showToast(`✅ Refund ${status}!`);
    loadCurrentSection();
  } catch (error) {
    console.error('Error processing refund:', error);
    showToast('❌ Failed to process refund.');
  }
};

// ---- VIEW REFUND ----
window.viewRefund = async function(refundId) {
  try {
    const docRef = doc(db, 'refundRequests', refundId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Refund not found.');
      return;
    }
    const refund = docSnap.data();

    const modal = document.createElement('div');
    modal.className = 'admin-modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Refund Request</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <p><strong>User:</strong> ${refund.userName || 'Unknown'}</p>
          <p><strong>Phone:</strong> ${refund.userPhone || 'N/A'}</p>
          <p><strong>Amount:</strong> R${(refund.amount || 0).toFixed(2)}</p>
          <p><strong>Status:</strong> ${(refund.status || 'pending').toUpperCase()}</p>
          <p><strong>Date:</strong> ${refund.createdAt ? refund.createdAt.toDate().toLocaleString() : 'N/A'}</p>
          ${refund.processedAt ? `<p><strong>Processed:</strong> ${refund.processedAt.toDate().toLocaleString()}</p>` : ''}
          ${refund.message ? `<p><strong>Message:</strong> ${refund.message}</p>` : ''}
          <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
            <a href="tel:${refund.userPhone}" class="btn-sm" style="background:#28a745;color:#fff;padding:0.3rem 0.8rem;border-radius:4px;text-decoration:none;">
              <i class="fas fa-phone"></i> Call
            </a>
            <a href="https://wa.me/${(refund.userPhone || '').replace(/\s/g, '')}" target="_blank" class="btn-sm" style="background:#25D366;color:#fff;padding:0.3rem 0.8rem;border-radius:4px;text-decoration:none;">
              <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
          </div>
        </div>
        <div class="modal-footer">
          ${refund.status === 'pending' ? `
            <button class="btn-sm btn-approve" onclick="processRefund('${refundId}','approved');this.closest('.admin-modal').remove();">Approve</button>
            <button class="btn-sm btn-reject" onclick="processRefund('${refundId}','rejected');this.closest('.admin-modal').remove();">Reject</button>
          ` : ''}
          ${refund.status === 'approved' ? `
            <button class="btn-sm btn-approve" onclick="markRefundPaid('${refundId}');this.closest('.admin-modal').remove();" style="background:#28a745;color:#fff;">Mark Paid</button>
          ` : ''}
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Error viewing refund:', error);
    showToast('Error loading refund details.');
  }
};

// ---- UPDATE ORDER STATUS ----
window.updateOrderStatus = function(orderId) {
  const statuses = ['pending', 'confirmed', 'packing', 'packed', 'collected', 'on_the_way', 'delivered', 'refunded'];
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Update Order Status</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Select Status</label>
          <select id="statusSelect">
            ${statuses.map(s => `<option value="${s}">${s.replace('_', ' ').toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Assign Driver (optional)</label>
          <select id="driverSelect">
            <option value="">None</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notes (optional)</label>
          <textarea id="statusNotes" rows="2" placeholder="Add notes about this status update..."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveStatusBtn">Update</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  loadDriversForSelect();

  modal.querySelector('#saveStatusBtn').addEventListener('click', async () => {
    const status = modal.querySelector('#statusSelect').value;
    const driverId = modal.querySelector('#driverSelect').value;
    const notes = modal.querySelector('#statusNotes').value;
    try {
      const updates = { orderStatus: status, updatedAt: serverTimestamp(), notes: notes || '' };
      if (driverId) {
        const driverDoc = await getDoc(doc(db, 'drivers', driverId));
        if (driverDoc.exists()) {
          const driver = driverDoc.data();
          updates.driverId = driverId;
          updates.driverName = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone;
          updates.driverPhone = driver.phone || '';
        }
      }
      await updateDoc(doc(db, 'orders', orderId), updates);
      showToast('✅ Order status updated!');
      modal.remove();
      loadCurrentSection();
    } catch (error) {
      console.error('Error updating order:', error);
      showToast('❌ Failed to update order status.');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

// ---- ASSIGN DRIVER ----
window.assignDriver = function(orderId) {
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Assign Driver to Order #${orderId.slice(-6).toUpperCase()}</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Select Driver</label>
          <select id="driverSelectAssign">
            <option value="">None</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notes (optional)</label>
          <textarea id="assignNotes" rows="2" placeholder="Add notes for the driver..."></textarea>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;">
          <i class="fas fa-info-circle"></i> Order status will be automatically set to "Assigned".
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="assignDriverBtn">Assign Driver</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  loadDriversForSelectById('driverSelectAssign');

  modal.querySelector('#assignDriverBtn').addEventListener('click', async () => {
    const driverId = modal.querySelector('#driverSelectAssign').value;
    const notes = modal.querySelector('#assignNotes').value;
    if (!driverId) {
      showToast('Please select a driver.');
      return;
    }
    try {
      const driverDoc = await getDoc(doc(db, 'drivers', driverId));
      if (!driverDoc.exists()) {
        showToast('Driver not found.');
        return;
      }
      const driver = driverDoc.data();
      const driverName = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone || 'Driver';
      const driverPhone = driver.phone || '';

      await updateDoc(doc(db, 'orders', orderId), {
        driverId: driverId,
        driverName: driverName,
        driverPhone: driverPhone,
        orderStatus: 'assigned',
        notes: notes || '',
        updatedAt: serverTimestamp()
      });
      showToast('✅ Driver assigned successfully!');
      modal.remove();
      loadCurrentSection();
    } catch (error) {
      console.error('Error assigning driver:', error);
      showToast('❌ Failed to assign driver.');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

// ---- VIEW ORDER ----
window.viewOrder = async function(orderId) {
  try {
    const docRef = doc(db, 'orders', orderId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Order not found.');
      return;
    }
    const order = docSnap.data();
    const itemsHtml = order.items ? order.items.map(item => `
      <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <span>${item.name} × ${item.quantity} ${item.alternateAccepted ? '🔄' : ''}</span>
        <span>R${(item.price * item.quantity).toFixed(2)}</span>
      </div>
    `).join('') : '<p>No items</p>';

    const modal = document.createElement('div');
    modal.className = 'admin-modal active';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:650px;">
        <div class="modal-header">
          <h3>Order #${orderId.slice(-6).toUpperCase()}</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">
            <div><strong>Customer:</strong> ${order.customerName || order.customerPhone || 'N/A'}</div>
            <div><strong>Phone:</strong> ${order.customerPhone || 'N/A'}</div>
            <div><strong>Store:</strong> ${order.store || 'N/A'}</div>
            <div><strong>Address:</strong> ${order.deliveryAddress?.street || order.deliveryAddress || 'N/A'}</div>
            <div><strong>Time Slot:</strong> ${order.timeSlot?.display || order.timeSlot || 'N/A'}</div>
            <div><strong>Status:</strong> ${(order.orderStatus || 'pending').replace('_', ' ').toUpperCase()}</div>
            <div><strong>Payment:</strong> ${(order.paymentStatus || 'pending').toUpperCase()}</div>
            <div><strong>Driver:</strong> ${order.driverName || 'Unassigned'}</div>
            ${order.driverPhone ? `<div><strong>Driver Phone:</strong> ${order.driverPhone}</div>` : ''}
          </div>
          ${order.testMode ? `<div style="background:#FFF7ED;padding:0.3rem 0.8rem;border-radius:8px;margin-bottom:0.5rem;font-size:0.8rem;color:var(--orange);"><i class="fas fa-vial"></i> Test Mode Order</div>` : ''}
          <hr style="margin:0.5rem 0;border-color:var(--border);">
          <h4>Items</h4>
          ${itemsHtml}
          <hr style="margin:0.5rem 0;border-color:var(--border);">
          <div style="display:flex;justify-content:space-between;font-weight:bold;">
            <span>Total</span>
            <span>R${(order.total || 0).toFixed(2)}</span>
          </div>
          ${order.refundAmount ? `<div style="color:var(--red);"><strong>Refunded:</strong> R${order.refundAmount.toFixed(2)}</div>` : ''}
          ${order.notes ? `<p style="margin-top:0.5rem;"><strong>Notes:</strong> ${order.notes}</p>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Error viewing order:', error);
    showToast('Error loading order details.');
  }
};

// ============================================================
//  HELPERS
// ============================================================
async function loadDriversForSelect() {
  try {
    const driversSnap = await getDocs(query(collection(db, 'drivers'), where('approved', '==', true)));
    const select = document.getElementById('driverSelect');
    if (!select) return;
    select.innerHTML = '<option value="">None</option>';
    driversSnap.forEach(doc => {
      const driver = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      const name = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone || 'Driver';
      option.textContent = `${name} (${driver.phone || 'no phone'})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading drivers:', error);
  }
}

async function loadDriversForSelectById(selectId) {
  try {
    const driversSnap = await getDocs(query(collection(db, 'drivers'), where('approved', '==', true)));
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">Select Driver</option>';
    driversSnap.forEach(doc => {
      const driver = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      const name = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone || 'Driver';
      option.textContent = `${name} (${driver.phone || 'no phone'})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading drivers:', error);
  }
}

// ---- SELECT ABANDONED USERS ----
window.selectAbandonedUsers = function() {
  const checkboxes = document.querySelectorAll('.abandoned-user-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
};

// ---- AREA MODALS ----
window.openAreaModal = function(areaData = null) {
  const isEdit = !!areaData;
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:500px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit' : 'Add'} Delivery Area</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Area Name *</label>
          <input type="text" id="areaName" value="${areaData?.name || ''}" placeholder="e.g. Verulam" />
        </div>
        <div class="form-group">
          <label>Delivery Fee (R)</label>
          <input type="number" id="areaFee" value="${areaData?.fee || 35}" step="0.50" min="0" />
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="areaActive">
            <option value="true" ${areaData?.active !== false ? 'selected' : ''}>Active</option>
            <option value="false" ${areaData?.active === false ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveAreaBtn">${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#saveAreaBtn').addEventListener('click', async () => {
    const name = document.getElementById('areaName').value.trim();
    const fee = parseFloat(document.getElementById('areaFee').value) || 35;
    const active = document.getElementById('areaActive').value === 'true';
    if (!name) {
      showToast('Area name is required.');
      return;
    }
    const data = { name, fee, active, updatedAt: serverTimestamp() };
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'areas', areaData.id), data);
        showToast('✅ Area updated successfully!');
      } else {
        await addDoc(collection(db, 'areas'), { ...data, createdAt: serverTimestamp() });
        showToast('✅ Area added successfully!');
      }
      modal.remove();
      loadCurrentSection();
    } catch (error) {
      console.error('Error saving area:', error);
      showToast('❌ Failed to save area.');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

window.editArea = function(areaId) {
  const docRef = doc(db, 'areas', areaId);
  getDoc(docRef).then(docSnap => {
    if (docSnap.exists()) {
      openAreaModal({ ...docSnap.data(), id: areaId });
    } else {
      showToast('Area not found.');
    }
  }).catch(error => {
    console.error('Error loading area:', error);
    showToast('Error loading area.');
  });
};

window.deleteArea = async function(areaId) {
  if (!confirm('Are you sure you want to delete this delivery area?')) return;
  try {
    await deleteDoc(doc(db, 'areas', areaId));
    showToast('✅ Area deleted successfully!');
    loadCurrentSection();
  } catch (error) {
    console.error('Error deleting area:', error);
    showToast('❌ Failed to delete area.');
  }
};

// ---- STORE EDIT/DELETE ----
window.editStore = function(storeId) {
  const docRef = doc(db, 'stores', storeId);
  getDoc(docRef).then(docSnap => {
    if (docSnap.exists()) {
      openStoreModal({ ...docSnap.data(), id: storeId });
    } else {
      showToast('Store not found.');
    }
  }).catch(error => {
    console.error('Error loading store:', error);
    showToast('Error loading store.');
  });
};

window.deleteStore = async function(storeId) {
  if (!confirm('Are you sure you want to delete this store? All products will also be deleted.')) return;
  try {
    const productsQuery = query(collection(db, 'products'), where('storeId', '==', storeId));
    const productsSnap = await getDocs(productsQuery);
    const deletePromises = [];
    productsSnap.forEach(doc => {
      deletePromises.push(deleteDoc(doc.ref));
    });
    await Promise.all(deletePromises);
    await deleteDoc(doc(db, 'stores', storeId));
    showToast('✅ Store and all products deleted successfully!');
    loadCurrentSection();
  } catch (error) {
    console.error('Error deleting store:', error);
    showToast('❌ Failed to delete store.');
  }
};

// ---- PRODUCT EDIT/DELETE ----
window.editProduct = function(productId) {
  const docRef = doc(db, 'products', productId);
  getDoc(docRef).then(docSnap => {
    if (docSnap.exists()) {
      openProductModal({ ...docSnap.data(), id: productId });
    } else {
      showToast('Product not found.');
    }
  }).catch(error => {
    console.error('Error loading product:', error);
    showToast('Error loading product.');
  });
};

window.deleteProduct = async function(productId) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  try {
    await deleteDoc(doc(db, 'products', productId));
    showToast('✅ Product deleted successfully!');
    loadCurrentSection();
  } catch (error) {
    console.error('Error deleting product:', error);
    showToast('❌ Failed to delete product.');
  }
};

// ---- SPECIAL EDIT/DELETE ----
window.editSpecial = function(specialId) {
  const docRef = doc(db, 'specials', specialId);
  getDoc(docRef).then(docSnap => {
    if (docSnap.exists()) {
      openSpecialModal({ ...docSnap.data(), id: specialId });
    } else {
      showToast('Special not found.');
    }
  }).catch(error => {
    console.error('Error loading special:', error);
    showToast('Error loading special.');
  });
};

window.deleteSpecial = async function(specialId) {
  if (!confirm('Are you sure you want to delete this special?')) return;
  try {
    await deleteDoc(doc(db, 'specials', specialId));
    showToast('✅ Special deleted successfully!');
    loadCurrentSection();
  } catch (error) {
    console.error('Error deleting special:', error);
    showToast('❌ Failed to delete special.');
  }
};

// ---- SPECIAL MODAL ----
window.openSpecialModal = function(specialData = null) {
  const isEdit = !!specialData;
  const modal = document.createElement('div');
  modal.className = 'admin-modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:550px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit' : 'Add'} Special</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Item Name *</label>
          <input type="text" id="specialItem" value="${specialData?.item || ''}" placeholder="e.g. Fresh Bread" />
        </div>
        <div class="form-group">
          <label>Store *</label>
          <input type="text" id="specialStore" value="${specialData?.store || ''}" placeholder="e.g. Golden Gate Super" />
        </div>
        <div class="form-group">
          <label>Price (R) *</label>
          <input type="number" id="specialPrice" value="${specialData?.price || ''}" step="0.01" />
        </div>
        <div class="form-group">
          <label>Old Price (R) - optional</label>
          <input type="number" id="specialOldPrice" value="${specialData?.oldPrice || ''}" step="0.01" />
        </div>
        <div class="form-group">
          <label>Tag</label>
          <input type="text" id="specialTag" value="${specialData?.tag || ''}" placeholder="50% OFF" />
        </div>
        <div class="form-group">
          <label>Image URL</label>
          <input type="text" id="specialImage" value="${specialData?.image || ''}" />
        </div>
        <div class="form-group">
          <label>Active</label>
          <select id="specialActive">
            <option value="true" ${specialData?.active !== false ? 'selected' : ''}>Yes</option>
            <option value="false" ${specialData?.active === false ? 'selected' : ''}>No</option>
          </select>
        </div>
        <div class="form-group">
          <label>End Date</label>
          <input type="date" id="specialEndDate" value="${specialData?.endDate ? specialData.endDate.toDate().toISOString().split('T')[0] : ''}" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveSpecialBtn">${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#saveSpecialBtn').addEventListener('click', async () => {
    const endDate = document.getElementById('specialEndDate').value;
    const data = {
      item: document.getElementById('specialItem').value.trim(),
      store: document.getElementById('specialStore').value.trim(),
      price: parseFloat(document.getElementById('specialPrice').value) || 0,
      oldPrice: parseFloat(document.getElementById('specialOldPrice').value) || null,
      tag: document.getElementById('specialTag').value.trim() || 'Special',
      image: document.getElementById('specialImage').value.trim() || 'img/placeholder.jpg',
      active: document.getElementById('specialActive').value === 'true',
      updatedAt: serverTimestamp()
    };
    if (endDate) data.endDate = new Date(endDate);
    if (!data.item || !data.store || !data.price) {
      showToast('Item, Store, and Price are required.');
      return;
    }
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'specials', specialData.id), data);
        showToast('✅ Special updated successfully!');
      } else {
        await addDoc(collection(db, 'specials'), { ...data, createdAt: serverTimestamp() });
        showToast('✅ Special added successfully!');
      }
      modal.remove();
      loadCurrentSection();
    } catch (error) {
      console.error('Error saving special:', error);
      showToast('❌ Failed to save special.');
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Auth listener will trigger dashboard load
});

// Expose functions to window for inline HTML calls
window.loadOrders = loadOrders;
window.loadRefunds = loadRefunds;
window.loadDrivers = loadDrivers;
window.loadStores = loadStores;
window.loadProducts = loadProducts;
window.loadSpecials = loadSpecials;
window.loadAreas = loadAreas;
window.loadNotifications = loadNotifications;
window.loadSettings = loadSettings;
window.loadTestMode = loadTestMode;
window.viewOrder = viewOrder;
window.viewRefund = viewRefund;
window.processRefund = processRefund;
window.markRefundPaid = markRefundPaid;
window.updateOrderStatus = updateOrderStatus;
window.refundOrder = refundOrder;
window.approveDriver = approveDriver;
window.toggleSuspendDriver = toggleSuspendDriver;
window.deleteDriver = deleteDriver;
window.viewDriver = viewDriver;
window.payDriver = payDriver;
window.editDriverArea = editDriverArea;
window.openStoreModal = openStoreModal;
window.editStore = editStore;
window.deleteStore = deleteStore;
window.toggleStoreClosed = toggleStoreClosed;
window.openProductModal = openProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.openSpecialModal = openSpecialModal;
window.editSpecial = editSpecial;
window.deleteSpecial = deleteSpecial;
window.openAreaModal = openAreaModal;
window.editArea = editArea;
window.deleteArea = deleteArea;
window.selectAbandonedUsers = selectAbandonedUsers;
window.sendStoreWhatsApp = sendStoreWhatsApp;
window.viewStoreNotif = viewStoreNotif;
window.deleteStoreNotification = deleteStoreNotification;
window.openCreditNoteModal = openCreditNoteModal;
window.assignDriver = assignDriver;