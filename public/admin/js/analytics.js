// ============================================================
//  ANALYTICS.JS — Admin analytics (with date range picker)
// ============================================================

import {
  db, collection, query, where, getDocs
} from '../../js/firebase-config.js';
import { showToast, showLoading, formatMoney } from './utils.js';

const adminContent = document.getElementById('adminContent');

window.loadAnalytics = loadAnalytics;
window.openStoreAnalytics = openStoreAnalytics;
window.applyDateFilter = applyDateFilter;

let _storesCache = [];
let _analyticsCache = {};
let _currentRange = {
  start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  end: new Date()
};

// ============================================================
//  LOAD ANALYTICS — entry point
// ============================================================
export async function loadAnalytics() {
  showLoading('Loading analytics...');

  try {
    const storesSnap = await getDocs(collection(db, 'stores'));
    _storesCache = [];
    storesSnap.forEach(doc => _storesCache.push({ id: doc.id, ...doc.data() }));

    await fetchDataForRange();
    renderDashboardShell();

    document.getElementById('applyDateFilter')?.addEventListener('click', applyDateFilter);

  } catch (error) {
    console.error('Error loading analytics:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading analytics. Please refresh.</p>`;
  }
}

// ============================================================
//  FETCH DATA FOR THE SELECTED RANGE
// ============================================================
async function fetchDataForRange() {
  const start = _currentRange.start;
  const end = _currentRange.end;

  const [
    storeViewsSnap,
    productViewsSnap,
    specialViewsSnap,
    ordersSnap
  ] = await Promise.all([
    getDocs(query(collection(db, 'analytics_store_views'), where('timestamp', '>=', start), where('timestamp', '<=', end))),
    getDocs(query(collection(db, 'analytics_product_views'), where('timestamp', '>=', start), where('timestamp', '<=', end))),
    getDocs(query(collection(db, 'analytics_special_views'), where('timestamp', '>=', start), where('timestamp', '<=', end))),
    getDocs(query(collection(db, 'orders'), where('createdAt', '>=', start), where('createdAt', '<=', end)))
  ]);

  const storeViews = storeViewsSnap.docs.map(d => d.data());
  const productViews = productViewsSnap.docs.map(d => d.data());
  const specialViews = specialViewsSnap.docs.map(d => d.data());
  const orders = ordersSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(o => o.testMode !== true && o.paymentStatus !== 'test_mode');

  _analyticsCache = {};
  _storesCache.forEach(store => {
    _analyticsCache[store.id] = {
      store: store,
      views: 0,
      productViews: 0,
      specialViews: 0,
      orders: [],
      dailyBreakdown: {},
      topItems: {},
      topSpecials: {}
    };
  });

  const getDayKey = (date) => {
    if (!date) return null;
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  };

  storeViews.forEach(v => {
    if (!v.storeId) return;
    const entry = _analyticsCache[v.storeId];
    if (!entry) return;
    entry.views++;
    const day = getDayKey(v.timestamp);
    if (day) entry.dailyBreakdown[day] = (entry.dailyBreakdown[day] || 0) + 1;
  });

  productViews.forEach(v => {
    if (!v.storeId) return;
    const entry = _analyticsCache[v.storeId];
    if (!entry) return;
    entry.productViews++;
    const day = getDayKey(v.timestamp);
    if (day) entry.dailyBreakdown[day] = (entry.dailyBreakdown[day] || 0) + 1;
  });

  specialViews.forEach(v => {
    if (!v.storeId) return;
    const entry = _analyticsCache[v.storeId];
    if (!entry) return;
    entry.specialViews++;
    if (v.specialId) {
      if (!entry.topSpecials[v.specialId]) entry.topSpecials[v.specialId] = { name: v.specialName || 'Unknown', views: 0 };
      entry.topSpecials[v.specialId].views++;
    }
  });

  orders.forEach(o => {
    const sid = o.storeId;
    if (!sid || !_analyticsCache[sid]) return;
    const entry = _analyticsCache[sid];
    const earnings = Number(o.subtotal || 0) + Number(o.packagingFee || 0);
    entry.orders.push({ ...o, _earnings: earnings });
    const day = getDayKey(o.createdAt);
    if (day) {
      if (!entry.dailyBreakdown[day]) entry.dailyBreakdown[day] = 0;
      entry.dailyBreakdown[day]++;
    }
  });

  orders.forEach(o => {
    const sid = o.storeId;
    if (!sid || !_analyticsCache[sid]) return;
    (o.items || []).forEach(item => {
      const key = item.name || item.id;
      if (!_analyticsCache[sid].topItems[key]) _analyticsCache[sid].topItems[key] = { name: key, qty: 0 };
      _analyticsCache[sid].topItems[key].qty += Number(item.quantity || 0);
    });
  });
}

// ============================================================
//  RENDER DASHBOARD SHELL
// ============================================================
function renderDashboardShell() {
  const startStr = _currentRange.start.toISOString().split('T')[0];
  const endStr = _currentRange.end.toISOString().split('T')[0];

  adminContent.innerHTML = `
    <div class="settings-card" style="margin-bottom:1rem;">
      <div style="display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap;">
        <div class="form-group" style="margin:0;flex:1;min-width:150px;">
          <label>Start Date</label>
          <input type="date" id="filterStartDate" value="${startStr}" />
        </div>
        <div class="form-group" style="margin:0;flex:1;min-width:150px;">
          <label>End Date</label>
          <input type="date" id="filterEndDate" value="${endStr}" />
        </div>
        <button class="btn-save" id="applyDateFilter" style="padding:10px 20px;height:44px;white-space:nowrap;">
          <i class="fas fa-filter"></i> Apply Filter
        </button>
      </div>
    </div>

    <div class="analytics-stores-grid" id="analyticsStoresGrid">
      ${renderStoreCards()}
    </div>
  `;

  document.querySelectorAll('.analytics-store-card').forEach(card => {
    card.addEventListener('click', () => openStoreAnalytics(card.dataset.storeId));
  });
}

// ============================================================
//  APPLY DATE FILTER
// ============================================================
async function applyDateFilter() {
  const startInput = document.getElementById('filterStartDate').value;
  const endInput = document.getElementById('filterEndDate').value;
  if (!startInput || !endInput) {
    showToast('Please select both start and end dates.');
    return;
  }

  const start = new Date(startInput);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endInput);
  end.setHours(23, 59, 59, 999);

  if (start > end) {
    showToast('Start date cannot be after end date.');
    return;
  }

  _currentRange = { start, end };
  showLoading('Filtering data...');
  await fetchDataForRange();
  renderDashboardShell();
}

// ============================================================
//  RENDER STORE CARDS
// ============================================================
function renderStoreCards() {
  if (_storesCache.length === 0) {
    return `<p style="text-align:center;color:var(--text-secondary);padding:2rem;">No stores yet.</p>`;
  }

  return _storesCache.map(store => {
    const a = _analyticsCache[store.id];
    if (!a) return '';

    const earnings = a.orders.reduce((sum, o) => sum + o._earnings, 0);
    const orderCount = a.orders.length;
    const totalViews = a.views + a.productViews + a.specialViews;

    return `
      <div class="analytics-store-card" data-store-id="${store.id}">
        <img src="${escapeAttr(store.logo || 'img/placeholder.jpg')}" alt="${escapeAttr(store.name || 'Store')}" class="analytics-store-logo" onerror="this.src='img/placeholder.jpg'" />
        <div class="analytics-store-info">
          <div class="analytics-store-name">${escapeHtml(store.name || 'Store')}</div>
          <div class="analytics-store-meta">${escapeHtml(store.area || '')}</div>
        </div>
        <div class="analytics-store-stats">
          <div class="store-stat">
            <span class="store-stat-value">${totalViews}</span>
            <span class="store-stat-label">views</span>
          </div>
          <div class="store-stat">
            <span class="store-stat-value">${orderCount}</span>
            <span class="store-stat-label">orders</span>
          </div>
          <div class="store-stat store-stat-earn">
            <span class="store-stat-value">${formatMoney(earnings)}</span>
            <span class="store-stat-label">earned</span>
          </div>
        </div>
        <i class="fas fa-chevron-right analytics-store-chevron"></i>
      </div>
    `;
  }).join('');
}

// ============================================================
//  STORE DETAIL MODAL
// ============================================================
function openStoreAnalytics(storeId) {
  const store = _storesCache.find(s => s.id === storeId);
  const a = _analyticsCache[storeId];
  if (!store || !a) {
    showToast('Store data not found.');
    return;
  }

  const existing = document.getElementById('storeAnalyticsModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'storeAnalyticsModal';
  modal.className = 'admin-modal active store-analytics-modal';

  const dailyRows = Object.entries(a.dailyBreakdown)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, count]) => `
      <tr>
        <td>${new Date(day).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
        <td style="text-align:right;">${count}</td>
      </tr>
    `).join('') || `<tr><td colspan="2" class="empty">No activity in this range.</td></tr>`;

  const topItems = Object.values(a.topItems).sort((x, y) => y.qty - x.qty).slice(0, 10);
  const topSpecials = Object.values(a.topSpecials).sort((x, y) => y.views - x.views).slice(0, 10);

  modal.innerHTML = `
    <div class="modal-content store-report-content">
      <div class="modal-header no-print">
        <h3><i class="fas fa-chart-line"></i> ${escapeHtml(store.name || 'Store')} — Analytics</h3>
        <button class="modal-close" onclick="document.getElementById('storeAnalyticsModal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:1rem;">
          <strong>Report Period:</strong> ${_currentRange.start.toLocaleDateString('en-ZA')} to ${_currentRange.end.toLocaleDateString('en-ZA')}
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem;">
          <div class="stat-card">
            <div class="stat-number">${a.views + a.productViews + a.specialViews}</div>
            <div class="stat-label">Total Views</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${a.orders.length}</div>
            <div class="stat-label">Orders</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${formatMoney(a.orders.reduce((s, o) => s + o._earnings, 0))}</div>
            <div class="stat-label">Earnings</div>
          </div>
        </div>

        <h4 style="font-size:1rem;font-weight:800;color:var(--navy);margin-bottom:0.5rem;">Daily Breakdown</h4>
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:1.5rem;">
          <thead><tr style="border-bottom:2px solid var(--border);"><th style="text-align:left;padding:8px;">Date</th><th style="text-align:right;padding:8px;">Views / Orders</th></tr></thead>
          <tbody>${dailyRows}</tbody>
        </table>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div>
            <h4 style="font-size:0.95rem;font-weight:800;color:var(--navy);margin-bottom:0.5rem;">Top Items</h4>
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
              <thead><tr style="border-bottom:2px solid var(--border);"><th style="text-align:left;padding:6px;">Item</th><th style="text-align:right;padding:6px;">Qty</th></tr></thead>
              <tbody>${topItems.length ? topItems.map(i => `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right;">${i.qty}</td></tr>`).join('') : '<tr><td colspan="2" class="empty">No items sold.</td></tr>'}</tbody>
            </table>
          </div>
          <div>
            <h4 style="font-size:0.95rem;font-weight:800;color:var(--navy);margin-bottom:0.5rem;">Top Specials</h4>
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
              <thead><tr style="border-bottom:2px solid var(--border);"><th style="text-align:left;padding:6px;">Special</th><th style="text-align:right;padding:6px;">Views</th></tr></thead>
              <tbody>${topSpecials.length ? topSpecials.map(s => `<tr><td>${escapeHtml(s.name)}</td><td style="text-align:right;">${s.views}</td></tr>`).join('') : '<tr><td colspan="2" class="empty">No specials viewed.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="modal-footer no-print">
        <button class="btn-cancel" onclick="document.getElementById('storeAnalyticsModal').remove()">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
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