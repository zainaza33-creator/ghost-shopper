// ============================================================
//  DASHBOARD.JS - Admin dashboard module (revamped)
//  Shows live operational state: current orders, new orders,
//  pending work, and today's financials.
// ============================================================

import {
  db,
  collection, query, where, orderBy, limit, getDocs, onSnapshot, doc, getDoc
} from '../../js/firebase-config.js';
import { showToast, showLoading, formatMoney, formatDateTime } from './utils.js';

const adminContent = document.getElementById('adminContent');

// ===== EXPOSE GLOBALLY =====
window.loadDashboard = loadDashboard;

// ===== STATE =====
let unsubscribeOnline = null;
let unsubscribeActiveOrders = null;
let unsubscribeNewOrders = null;

// ============================================================
//  LOAD DASHBOARD
// ============================================================
export async function loadDashboard() {
  showLoading('Loading dashboard...');

  // Clean up any old listeners
  if (unsubscribeOnline) { try { unsubscribeOnline(); } catch (_) {} }
  if (unsubscribeActiveOrders) { try { unsubscribeActiveOrders(); } catch (_) {} }
  if (unsubscribeNewOrders) { try { unsubscribeNewOrders(); } catch (_) {} }

  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);

    // ===== 1. One-shot stats (load once) =====
    const [
      usersSnap,
      driversSnap,
      storesSnap,
      productsSnap,
      refundsSnap,
      driverPaymentsSnap
    ] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'drivers')),
      getDocs(collection(db, 'stores')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'refundRequests')),
      getDocs(collection(db, 'driverPayments'))
    ]);

    let totalUsers = 0;
    let driversOnline = 0;
    let approvedDrivers = 0;
    let pendingDrivers = 0;
    let outOfStockProducts = 0;
    let pendingRefunds = 0;
    let pendingDriverPayments = 0;

    usersSnap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.role === 'customer' || !data.role) totalUsers++;
    });

    driversSnap.forEach(docSnap => {
      const d = docSnap.data();
      if (d.approved) approvedDrivers++;
      else pendingDrivers++;
      if (d.isOnline === true) driversOnline++;
    });

    productsSnap.forEach(docSnap => {
      if (docSnap.data().stock === false) outOfStockProducts++;
    });

    refundsSnap.forEach(docSnap => {
      const r = docSnap.data();
      if (r.status === 'pending') pendingRefunds++;
    });

    driverPaymentsSnap.forEach(docSnap => {
      const p = docSnap.data();
      if (p.status === 'requested') pendingDriverPayments++;
    });

    // ===== 2. Financial summary for today =====
    // Query orders created today with status delivered
    const ordersRef = collection(db, 'orders');
    const todayDeliveredQuery = query(
      ordersRef,
      where('orderStatus', '==', 'delivered'),
      where('createdAt', '>=', startOfToday)
    );
    const todayDeliveredSnap = await getDocs(todayDeliveredQuery);

    let todayStoreEarnings = 0;
    let todayDeliveryFees = 0;

    todayDeliveredSnap.forEach(docSnap => {
      const order = docSnap.data();
      // 🔥 Skip test orders
      if (order.testMode === true || order.paymentStatus === 'test_mode') return;
      const subtotal = Number(order.subtotal || 0);
      const packagingFee = Number(order.packagingFee || 0);
      const deliveryFee = Number(order.deliveryFee || 0);
      todayStoreEarnings += subtotal + packagingFee;
      todayDeliveryFees += deliveryFee;
    });

    // Paid to drivers this month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthPaymentsSnap = await getDocs(collection(db, 'driverPayments'));
    let paidThisMonth = 0;
    monthPaymentsSnap.forEach(docSnap => {
      const p = docSnap.data();
      if (p.status === 'paid' && p.paidAt) {
        const paidAt = p.paidAt.toDate ? p.paidAt.toDate() : new Date(p.paidAt);
        if (paidAt >= startOfMonth) paidAmountAdd(p.amount);
      }
    });

    function paidAmountAdd(amount) {
      paidThisMonth += Number(amount || 0);
    }

    // ===== 3. Render shell =====
    adminContent.innerHTML = `
      <!-- QUICK LINKS -->
      <div class="dashboard-quick-links">
        <button class="quick-link-btn" data-open-section="orders">
          <i class="fas fa-shopping-bag"></i>
          <span>Orders</span>
        </button>
        <button class="quick-link-btn" data-open-section="drivers">
          <i class="fas fa-motorcycle"></i>
          <span>Drivers</span>
        </button>
        <button class="quick-link-btn" data-open-section="storeNotifications">
          <i class="fas fa-store"></i>
          <span>Store Notifs</span>
        </button>
        <button class="quick-link-btn" data-open-section="refunds">
          <i class="fas fa-undo-alt"></i>
          <span>Refunds</span>
        </button>
        <button class="quick-link-btn" data-open-section="analytics">
          <i class="fas fa-chart-line"></i>
          <span>Analytics</span>
        </button>
      </div>

      <!-- LIVE STATUS -->
      <div class="stats-grid compact">
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-users" style="color:var(--green);"></i></div>
          <div class="stat-number" id="dashOnlineNow">0</div>
          <div class="stat-label">Online now</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-user-friends"></i></div>
          <div class="stat-number">${totalUsers}</div>
          <div class="stat-label">Total customers</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-motorcycle" style="color:var(--orange);"></i></div>
          <div class="stat-number">${driversOnline}</div>
          <div class="stat-label">Drivers online</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><i class="fas fa-truck" style="color:var(--blue);"></i></div>
          <div class="stat-number" id="dashActiveOrdersCount">—</div>
          <div class="stat-label">Active orders</div>
        </div>
      </div>

      <!-- CURRENT ORDERS -->
      <div class="dashboard-panel" id="dashCurrentOrders">
        <div class="panel-header">
          <h3>
            <i class="fas fa-fire"></i> Current orders
            <span class="panel-badge" id="dashCurrentOrdersBadge">0</span>
          </h3>
          <button class="btn-secondary small" data-open-section="orders">
            View all <i class="fas fa-arrow-right"></i>
          </button>
        </div>
        <div class="panel-body" id="dashCurrentOrdersList">
          <p style="text-align:center;color:var(--text-secondary);padding:1rem;">Loading current orders...</p>
        </div>
      </div>

      <!-- NEW ORDERS TODAY -->
      <div class="dashboard-panel" id="dashNewOrders">
        <div class="panel-header">
          <h3>
            <i class="fas fa-bell"></i> New orders (today)
            <span class="panel-badge orange" id="dashNewOrdersBadge">0</span>
          </h3>
        </div>
        <div class="panel-body" id="dashNewOrdersList">
          <p style="text-align:center;color:var(--text-secondary);padding:1rem;">Loading today's orders...</p>
        </div>
      </div>

      <!-- PENDING WORK -->
      <div class="dashboard-panel">
        <div class="panel-header">
          <h3><i class="fas fa-hourglass-half"></i> Pending work</h3>
        </div>
        <div class="stats-grid compact" style="padding:0.8rem;">
          <button class="stat-card stat-card-clickable" data-open-section="orders">
            <div class="stat-icon"><i class="fas fa-clock" style="color:var(--orange);"></i></div>
            <div class="stat-number" style="color:var(--orange);" id="dashPendingOrders">0</div>
            <div class="stat-label">Pending orders</div>
          </button>
          <button class="stat-card stat-card-clickable" data-open-section="drivers">
            <div class="stat-icon"><i class="fas fa-user-clock" style="color:var(--orange);"></i></div>
            <div class="stat-number" style="color:var(--orange);">${pendingDrivers}</div>
            <div class="stat-label">Drivers awaiting approval</div>
          </button>
          <button class="stat-card stat-card-clickable" data-open-section="refunds">
            <div class="stat-icon"><i class="fas fa-undo-alt" style="color:var(--orange);"></i></div>
            <div class="stat-number" style="color:var(--orange);">${pendingRefunds}</div>
            <div class="stat-label">Pending refunds</div>
          </button>
          <button class="stat-card stat-card-clickable" data-open-section="driverPayments">
            <div class="stat-icon"><i class="fas fa-hand-holding-usd" style="color:var(--orange);"></i></div>
            <div class="stat-number" style="color:var(--orange);">${pendingDriverPayments}</div>
            <div class="stat-label">Driver payment requests</div>
          </button>
        </div>
      </div>

      <!-- FINANCIALS -->
      <div class="dashboard-panel">
        <div class="panel-header">
          <h3><i class="fas fa-money-bill-wave"></i> Today</h3>
        </div>
        <div class="stats-grid compact" style="padding:0.8rem;">
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-store" style="color:var(--green);"></i></div>
            <div class="stat-number">${formatMoney(todayStoreEarnings)}</div>
            <div class="stat-label">Store earnings (items + packaging)</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-truck" style="color:var(--blue);"></i></div>
            <div class="stat-number">${formatMoney(todayDeliveryFees)}</div>
            <div class="stat-label">Delivery fees collected</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-wallet" style="color:var(--orange);"></i></div>
            <div class="stat-number">${formatMoney(paidThisMonth)}</div>
            <div class="stat-label">Paid to drivers (this month)</div>
          </div>
        </div>
      </div>

      <!-- QUICK STATS (the old ones kept for reference) -->
      <div class="dashboard-panel">
        <div class="panel-header">
          <h3><i class="fas fa-cubes"></i> Snapshot</h3>
        </div>
        <div class="stats-grid compact" style="padding:0.8rem;">
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-store"></i></div>
            <div class="stat-number">${storesSnap.size}</div>
            <div class="stat-label">Stores</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-box"></i></div>
            <div class="stat-number">${productsSnap.size}</div>
            <div class="stat-label">Products</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-exclamation-triangle" style="color:var(--red);"></i></div>
            <div class="stat-number" style="color:var(--red);">${outOfStockProducts}</div>
            <div class="stat-label">Out of stock</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-motorcycle"></i></div>
            <div class="stat-number">${approvedDrivers}</div>
            <div class="stat-label">Approved drivers</div>
          </div>
        </div>
      </div>
    `;

    // ===== 4. Wire quick links =====
    adminContent.querySelectorAll('[data-open-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.openSection;
        const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
        if (navItem) navItem.click();
      });
    });

    // ===== 5. Live "online now" counter =====
    const onlineQuery = query(
      collection(db, 'analytics_sessions'),
      where('lastActive', '>', fiveMinsAgo)
    );
    unsubscribeOnline = onSnapshot(onlineQuery, (snap) => {
      const el = document.getElementById('dashOnlineNow');
      if (el) el.textContent = snap.size;
    });

    // ===== 6. Live current orders (fire snapshot) =====
    const currentStatuses = ['confirmed', 'packing', 'packed', 'ready', 'assigned', 'collected', 'on_the_way'];
    const currentOrdersQuery = query(
      ordersRef,
      where('orderStatus', 'in', currentStatuses)
    );
    unsubscribeActiveOrders = onSnapshot(currentOrdersQuery, (snap) => {
      const orders = [];
      snap.forEach(docSnap => {
        const o = { id: docSnap.id, ...docSnap.data() };
        // 🔥 Skip test orders
        if (o.testMode === true || o.paymentStatus === 'test_mode') return;
        orders.push(o);
      });
      orders.sort((a, b) => {
        const aT = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bT = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bT - aT;
      });

      const countEl = document.getElementById('dashActiveOrdersCount');
      if (countEl) countEl.textContent = orders.length;

      const badgeEl = document.getElementById('dashCurrentOrdersBadge');
      if (badgeEl) badgeEl.textContent = orders.length;

      renderCurrentOrders(orders);
    });

    // ===== 7. Live new orders today =====
    const newOrdersQuery = query(
      ordersRef,
      where('createdAt', '>=', startOfToday)
    );
    unsubscribeNewOrders = onSnapshot(newOrdersQuery, (snap) => {
      const orders = [];
      snap.forEach(docSnap => {
        const o = { id: docSnap.id, ...docSnap.data() };
        // 🔥 Skip test orders
        if (o.testMode === true || o.paymentStatus === 'test_mode') return;
        orders.push(o);
      });
      orders.sort((a, b) => {
        const aT = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bT = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bT - aT;
      });

      const badgeEl = document.getElementById('dashNewOrdersBadge');
      if (badgeEl) badgeEl.textContent = orders.length;

      renderNewOrders(orders);
    });

    // ===== 8. Update navigation badges =====
    document.getElementById('orderBadge').textContent = pendingRefunds + 0; // kept for existing badge wiring
    document.getElementById('driverBadge').textContent = pendingDrivers;
    document.getElementById('refundBadge').textContent = pendingRefunds;

    // Pending orders badge in sidebar
    const pendingOrdersQuery = query(
      collection(db, 'orders'),
      where('orderStatus', 'in', ['pending_payment', 'confirmed'])
    );
    getDocs(pendingOrdersQuery).then(pendingSnap => {
      const el = document.getElementById('dashPendingOrders');
      if (el) el.textContent = pendingSnap.size;
      const badge = document.getElementById('orderBadge');
      if (badge) badge.textContent = pendingSnap.size;
    });

  } catch (error) {
    console.error('Error loading dashboard:', error);
    adminContent.innerHTML = `<p style="color:var(--red);text-align:center;padding:2rem;">Error loading dashboard. Please refresh.</p>`;
  }
}

// ============================================================
//  RENDER CURRENT ORDERS
// ============================================================
function renderCurrentOrders(orders) {
  const list = document.getElementById('dashCurrentOrdersList');
  if (!list) return;

  if (orders.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:1rem;">No orders in progress right now.</p>`;
    return;
  }

  // Show up to 8 most recent
  const preview = orders.slice(0, 8);

  list.innerHTML = preview.map(order => {
    const created = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
    const statusLabel = (order.orderStatus || '').replace(/_/g, ' ').toUpperCase();
    const statusClass = 'status-' + (order.orderStatus || 'pending');
    const store = order.store || 'Store';
    const customer = order.customerName || order.customerPhone || 'Customer';
    const driver = order.driverName || null;
    const total = Number(order.total || 0);
    const earnings = Number(order.subtotal || 0) + Number(order.packagingFee || 0);

    return `
      <div class="current-order-row">
        <div class="current-order-id">#${order.id.slice(-6).toUpperCase()}</div>
        <div class="current-order-meta">
          <div class="current-order-line"><i class="fas fa-store"></i> ${escapeHtml(store)}</div>
          <div class="current-order-line"><i class="fas fa-user"></i> ${escapeHtml(customer)}</div>
          ${driver ? `<div class="current-order-line"><i class="fas fa-motorcycle"></i> ${escapeHtml(driver)}</div>` : ''}
          <div class="current-order-line"><i class="fas fa-clock"></i> ${created.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div class="current-order-right">
          <span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
          <span class="current-order-earn">Store: ${formatMoney(earnings)}</span>
        </div>
      </div>
    `;
  }).join('');

  if (orders.length > 8) {
    list.innerHTML += `<p style="text-align:center;color:var(--text-secondary);font-size:0.8rem;padding:0.6rem;">+${orders.length - 8} more — open Orders to see all</p>`;
  }
}

// ============================================================
//  RENDER NEW ORDERS (TODAY)
// ============================================================
function renderNewOrders(orders) {
  const list = document.getElementById('dashNewOrdersList');
  if (!list) return;

  if (orders.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:1rem;">No orders placed today yet.</p>`;
    return;
  }

  const preview = orders.slice(0, 5);

  list.innerHTML = preview.map(order => {
    const created = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
    const store = order.store || 'Store';
    const customer = order.customerName || order.customerPhone || 'Customer';
    const total = Number(order.total || 0);
    const isTest = order.testMode === true;

    return `
      <div class="new-order-row">
        <div>
          <strong>#${order.id.slice(-6).toUpperCase()}</strong>
          ${isTest ? '<span class="test-badge">TEST</span>' : ''}
        </div>
        <div class="new-order-meta">${escapeHtml(customer)} — ${escapeHtml(store)}</div>
        <div class="new-order-time">${created.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `;
  }).join('');

  if (orders.length > 5) {
    list.innerHTML += `<p style="text-align:center;color:var(--text-secondary);font-size:0.8rem;padding:0.6rem;">+${orders.length - 5} more</p>`;
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