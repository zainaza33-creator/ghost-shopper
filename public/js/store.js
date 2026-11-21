// ============================================================
//  store.js — Ghost Shopper Store page
//  Store hero (navy gradient), browse items grid, flyers rail,
//  request-an-item feature, category/sort filters.
//  Flyers use the new shape: flyers[{ title, pages[], startDate,
//  endDate, slotId }]. Renders all active flyers in a rail with
//  blue accents. Click a tile → modal with prev/next for 2 pages.
//
//  STOCK SAFETY: Out-of-stock browse cards are not clickable.
//  Out-of-stock specials render without the + button.
// ============================================================

console.log('🚀 store.js booting...');

import {
  db,
  getDocs, collection, query, where, doc, getDoc, onSnapshot,
  addDoc, serverTimestamp
} from './firebase-config.js';

import {
  initGlobal,
  showToast,
  updateCartBadge,
  getCart,
  updateAuthIconState,
  openNotificationModal
} from './global.js';

import { auth } from './firebase-config.js';

import { openProductModal, setProductModalData } from './product-modal.js';
import { getActivePrice } from './cart-utils.js';
import { getWeeklyHoursDisplay } from './hours-utils.js';
import { getCatalog } from './catalog-cache.js';

// ============================================================
//  ANALYTICS — non-blocking
// ============================================================
let trackPageView = () => {};
let trackStoreView = () => {};
let trackProductView = () => {};
let trackFlyerView = () => {};
let trackSpecialView = () => {};

import('./analytics.js')
  .then(mod => {
    if (!mod) return;
    if (typeof mod.trackPageView === 'function') trackPageView = mod.trackPageView;
    if (typeof mod.trackStoreView === 'function') trackStoreView = mod.trackStoreView;
    if (typeof mod.trackProductView === 'function') trackProductView = mod.trackProductView;
    if (typeof mod.trackFlyerView === 'function') trackFlyerView = mod.trackFlyerView;
    if (typeof mod.trackSpecialView === 'function') trackSpecialView = mod.trackSpecialView;
  })
  .catch(err => {
    console.warn('analytics.js unavailable (non-fatal):', err?.message || err);
  });

// ===== DOM =====
const loadingScreen    = document.getElementById('loadingScreen');
const flyerGrid        = document.getElementById('flyerGrid');
const flyerSection     = document.getElementById('flyerSection');
const storeSpecialsGrid    = document.getElementById('storeSpecialsGrid');
const storeSpecialsSection = document.getElementById('storeSpecialsSection');

const browseGrid       = document.getElementById('browseItemsGrid');
const browseCount      = document.getElementById('browseItemsCount');
const browseEmpty      = document.getElementById('browseItemsEmpty');
const browseEmptyText  = document.getElementById('browseItemsEmptyText');
const searchInput      = document.getElementById('browseItemsSearch');
const searchClear      = document.getElementById('browseItemsSearchClear');
const backToTop        = document.getElementById('backToTop');

const filterCategory   = document.getElementById('filterCategory');
const sortBy           = document.getElementById('sortBy');

const requestItemBtn   = document.getElementById('requestItemBtn');
const requestItemModal = document.getElementById('requestItemModal');
const requestStoreName = document.getElementById('requestStoreName');
const requestItemName  = document.getElementById('requestItemName');
const requestItemNote  = document.getElementById('requestItemNote');
const requestContact   = document.getElementById('requestContact');
const requestNotifyMe  = document.getElementById('requestNotifyMe');
const requestSubmitBtn = document.getElementById('requestSubmitBtn');

// ===== State =====
const MAX_FLYERS_VISIBLE = 10;
const MAX_FLYER_PAGES = 2;

let storeData = null;
let storeProducts = [];
let storeSpecials = [];
let storesData = [];
let deliveryFee = 35;
let filteredProducts = [];
let activeFlyers = [];

let activeCategory = 'all';
let activeSort = 'price-asc';

const urlParams = new URLSearchParams(window.location.search);
// 1. Check for clean URL path first: /store/some-slug
const pathParts = window.location.pathname.split('/');
const isCleanUrl = pathParts[1] === 'store' && pathParts[2];
const storeSlug = isCleanUrl ? pathParts[2] : null;

// 2. Fallback to old query params (so old links don't break)
const storeId = urlParams.get('id');
const storeNameParam = urlParams.get('name');

// ============================================================
//  DECORATE PRODUCT
// ============================================================
function decorateProduct(p) {
  if (!p) return p;
  if (!storeData) return p;
  return {
    ...p,
    store: p.store || storeData.name,
    storeName: p.storeName || storeData.name,
    storeId: p.storeId || storeData.id
  };
}

// ============================================================
//  BOOTSTRAP
// ============================================================
window.addEventListener('load', () => {
  setTimeout(hideLoader, 400);
  setTimeout(hideLoader, 5000);

  try {
    const p = initGlobal();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.warn('initGlobal error (non-fatal):', err));
    }
  } catch (err) {
    console.warn('initGlobal threw (non-fatal):', err);
  }

  updateCartBadge();
  updateAuthIconState();
  try { trackPageView(); } catch (_) {}

  loadDeliveryFee();
  loadStoreData();
  loadStoresForModalFeed();
  initSearch();
  initBackToTop();
  initRequestItemFeature();
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
}

// ============================================================
//  DELIVERY FEE
// ============================================================
function loadDeliveryFee() {
  const settingsRef = doc(db, 'settings', 'delivery');
  onSnapshot(settingsRef, (docSnap) => {
    if (docSnap.exists()) {
      deliveryFee = docSnap.data().fee || 35;
      const feeEl = document.getElementById('storeDeliveryFee');
      if (feeEl) feeEl.textContent = deliveryFee;
      const feePill = document.getElementById('storeFeePill');
      if (feePill) feePill.hidden = false;
    }
  }, (err) => console.warn('Error loading delivery fee:', err));
}

// ============================================================
//  STORES FEED (for product modal alternatives)
// ============================================================
function loadStoresForModalFeed() {
  onSnapshot(collection(db, 'stores'), (snapshot) => {
    storesData = [];
    snapshot.forEach(d => storesData.push({ id: d.id, ...d.data() }));
    setProductModalData({ stores: storesData, products: storeProducts });
  }, (err) => console.warn('Error loading stores feed:', err));
}

// ============================================================
//  LOAD STORE + PRODUCTS + SPECIALS
// ============================================================
async function loadStoreData() {
  if (!storeId && !storeNameParam && !storeSlug) {
    showNotFound('No store selected.');
    return;
  }

  try {
    let storeDoc = null;

    // 1. Try finding by ID (old way)
    if (storeId) {
      const snap = await getDoc(doc(db, 'stores', storeId));
      if (snap.exists()) storeDoc = { id: snap.id, ...snap.data() };
    }
    
    // 2. Try finding by name (old way)
    if (!storeDoc && storeNameParam) {
      const qs = query(collection(db, 'stores'), where('name', '==', storeNameParam));
      const snap = await getDocs(qs);
      if (!snap.empty) {
        const d = snap.docs[0];
        storeDoc = { id: d.id, ...d.data() };
      }
    }

    // 3. NEW: Try finding by slug (clean URL)
    if (!storeDoc && storeSlug) {
      // Fetch all stores and match the slug locally
      const snap = await getDocs(collection(db, 'stores'));
      snap.forEach(d => {
        if (storeDoc) return; // Stop if we already found it
        const data = d.data();
        const generatedSlug = (data.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (generatedSlug === storeSlug) {
          storeDoc = { id: d.id, ...data };
        }
      });
    }

    if (!storeDoc) {
      showNotFound('The store you are looking for does not exist.');
      return;
    }

    storeData = storeDoc;
    try { trackStoreView(storeData.id, storeData.name); } catch (_) {}

    // Use our new cache module
    const { products } = await getCatalog();
    // Filter the cached products to just this store
    storeProducts = products.filter(p => p.storeId === storeData.id);

    storeSpecials = [];
    try {
      const specialsQuery = query(
        collection(db, 'specials'),
        where('store', '==', storeData.name),
        where('active', '==', true)
      );
      const specialsSnap = await getDocs(specialsQuery);
      const now = new Date();
      specialsSnap.forEach(d => {
        const s = d.data();
        if (s.endDate) {
          const end = s.endDate.toDate ? s.endDate.toDate() : new Date(s.endDate);
          if (!isNaN(end) && end < now) return;
        }
        const endDate = s.endDate?.toDate ? s.endDate.toDate() : null;
        const daysLeft = endDate ? Math.ceil((endDate - now) / 86400000) : 0;
        storeSpecials.push({
          id: d.id,
          ...s,
          endDate,
          daysLeft,
          timeStatus: (endDate && daysLeft <= 3) ? 'ending_soon' : 'active'
        });
      });
    } catch (err) {
      console.warn('Could not load store specials:', err);
    }

    // ---- Flyers ----
    activeFlyers = (Array.isArray(storeData.flyers) ? storeData.flyers : [])
      .filter(f => isFlyerActive(f))
      .sort((a, b) => tsToMillis(b.uploadedAt) - tsToMillis(a.uploadedAt))
      .slice(0, MAX_FLYERS_VISIBLE);

    setProductModalData({ stores: storesData, products: storeProducts });

    renderHeader();
    renderFlyers();
    renderStoreSpecials();
    populateCategoryFilter();
    renderBrowseItems();
  } catch (err) {
    console.error('Error loading store data:', err);
    showNotFound(err.message || 'Error loading store.');
  }
}

function showNotFound(msg) {
  const main = document.querySelector('.store-page');
  if (main) {
    main.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;">
        <i class="fas fa-store-slash" style="font-size:2rem;color:var(--text-muted);display:block;margin-bottom:12px;"></i>
        <h2 style="font-size:1.15rem;color:var(--navy);margin:0 0 6px;">Store not available</h2>
        <p style="font-size:0.9rem;color:var(--text-secondary);margin:0 0 14px;">${escapeHtml(msg)}</p>
        <a href="/stores.html" class="btn-primary" style="display:inline-flex;text-decoration:none;">
          <i class="fas fa-store"></i> Browse stores
        </a>
      </div>
    `;
  }
}

// ============================================================
//  HEADER
// ============================================================
function renderHeader() {
  if (!storeData) return;

  const logo = document.getElementById('storeLogo');
  if (logo) logo.src = storeData.logo || storeData.image || 'img/placeholder.jpg';

  const name = document.getElementById('storeName');
  if (name) name.textContent = storeData.name || 'Store';

  const rating = document.getElementById('storeRating');
  if (rating) rating.textContent = storeData.rating || '0.0';

  const reviews = document.getElementById('storeReviews');
  if (reviews) reviews.textContent = storeData.reviewCount || 0;

  const desc = document.getElementById('storeDescription');
  if (desc) desc.textContent = storeData.description || '';

  renderHoursFact();

  const address = storeData.address || '';
  const addressFact = document.getElementById('storeAddressFact');
  const addressEl = document.getElementById('storeAddress');
  if (address && addressFact && addressEl) {
    addressEl.textContent = address;
    addressFact.href = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
    addressFact.hidden = false;
  }

  const phone = storeData.phone || '';
  const phoneFact = document.getElementById('storePhoneFact');
  const phoneEl = document.getElementById('storePhone');
  if (phone && phoneFact && phoneEl) {
    phoneEl.textContent = phone;
    phoneFact.href = `tel:${phone.replace(/\s/g, '')}`;
    phoneFact.hidden = false;
  }

  const feePill = document.getElementById('storeFeePill');
  if (feePill) feePill.hidden = false;
  const feeEl = document.getElementById('storeDeliveryFee');
  if (feeEl) feeEl.textContent = deliveryFee;

  if (requestStoreName) requestStoreName.textContent = storeData.name || 'this store';
}

// ============================================================
//  HOURS FACT — compact (today) by default, toggle expands to
//  a 3×3 grid showing all 7 days.
// ============================================================
function renderHoursFact() {
  const hoursEl = document.getElementById('storeHours');
  if (!hoursEl) return;

  const days = getWeeklyHoursDisplay(storeData);   // Mon..Sun, each { day, times, closed }
  const todayIdx = new Date().getDay();            // 0..6, Sun = 0
  // getWeeklyHoursDisplay returns Mon..Sun order, so map:
  const orderIdx = (todayIdx === 0) ? 6 : todayIdx - 1;
  const today = days[orderIdx];
  const todayShort = today.day.slice(0, 3);        // "Mon", "Tue", …

  const todayHtml = today.closed
    ? `<span class="store-hours-today-line is-closed">${escapeHtml(todayShort)} · Closed today</span>`
    : `<span class="store-hours-today-line">${escapeHtml(todayShort)} · ${escapeHtml(today.times)}</span>`;

  const gridHtml = days.map((d, i) => `
    <div class="store-hours-cell ${i === orderIdx ? 'is-today' : ''}">
      <span class="store-hours-day">${escapeHtml(d.day.slice(0, 3))}</span>
      <span class="store-hours-time ${d.closed ? 'is-closed' : ''}">${escapeHtml(d.closed ? 'Closed' : d.times)}</span>
    </div>
  `).join('');

  hoursEl.innerHTML = `
    <div class="store-hours-compact">
      ${todayHtml}
      <button type="button" class="store-hours-toggle" aria-expanded="false" aria-controls="storeHoursGrid">
        <span class="store-hours-toggle-label">All days</span>
        <i class="fas fa-chevron-down" aria-hidden="true"></i>
      </button>
    </div>
    <div class="store-hours-grid" id="storeHoursGrid" hidden>
      ${gridHtml}
    </div>
  `;

  wireHoursToggle();
}

function wireHoursToggle() {
  const toggle = document.querySelector('.store-hours-toggle');
  const grid = document.getElementById('storeHoursGrid');
  if (!toggle || !grid) return;

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = toggle.getAttribute('aria-expanded') === 'true';
    const next = !open;
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    grid.hidden = !next;
    const label = toggle.querySelector('.store-hours-toggle-label');
    if (label) label.textContent = next ? 'Hide' : 'All days';
    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-chevron-down', !next);
      icon.classList.toggle('fa-chevron-up', next);
    }
  });
}

// ============================================================
//  FLYERS — rail with all active flyers
// ============================================================
function renderFlyers() {
  if (!flyerSection || !flyerGrid) return;

  if (!activeFlyers.length) {
    flyerSection.hidden = true;
    return;
  }

  flyerSection.hidden = false;

  flyerGrid.innerHTML = activeFlyers.map((f, idx) => {
    const pages = Array.isArray(f.pages) ? f.pages.filter(Boolean) : [];
    const thumb = pages[0] || 'img/placeholder.jpg';
    const pageCount = pages.length;
    const dateLabel = formatFlyerDateRange(f);

    return `
      <button class="flyer-tile" type="button" data-flyer-index="${idx}" aria-label="Open flyer: ${escapeHtml(f.title || 'Flyer')}">
        <div class="flyer-tile-img-wrap">
          <img
            src="${escapeHtml(thumb)}"
            alt="${escapeHtml(f.title || 'Flyer')}"
            loading="lazy"
            decoding="async"
            onerror="this.src='img/placeholder.jpg'"
          />
          ${pageCount > 1 ? `
            <span class="flyer-tile-pages-badge">
              <i class="fas fa-clone" aria-hidden="true"></i> ${pageCount} pages
            </span>` : ''}
        </div>
        <div class="flyer-tile-info">
          <div class="flyer-tile-title">${escapeHtml(f.title || 'Flyer')}</div>
          ${dateLabel ? `<div class="flyer-tile-date"><i class="fas fa-calendar" aria-hidden="true"></i> ${escapeHtml(dateLabel)}</div>` : ''}
        </div>
      </button>
    `;
  }).join('');

  flyerGrid.querySelectorAll('.flyer-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.flyerIndex, 10);
      const f = activeFlyers[idx];
      if (f) openFlyerModal(f);
    });
  });
}

function isFlyerActive(flyer) {
  if (!flyer) return false;
  const pages = Array.isArray(flyer.pages) ? flyer.pages.filter(Boolean) : [];
  if (!pages.length) return false;

  const now = Date.now();
  const start = tsToMillis(flyer.startDate);
  const end = tsToMillis(flyer.endDate);
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts._seconds !== undefined) return ts._seconds * 1000;
  if (ts.seconds !== undefined) return ts.seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatFlyerDateRange(flyer) {
  const startMs = tsToMillis(flyer.startDate);
  const endMs = tsToMillis(flyer.endDate);
  const fmt = (ms) => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
    } catch (_) {
      return new Date(ms).toDateString();
    }
  };
  const start = fmt(startMs);
  const end = fmt(endMs);
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return '';
}

// ============================================================
//  FLYER MODAL — with prev/next for multi-page
// ============================================================
function openFlyerModal(flyer) {
  if (!flyer) return;
  const pages = Array.isArray(flyer.pages) ? flyer.pages.filter(Boolean) : [];
  if (!pages.length) return;

  try { trackFlyerView(flyer.slotId || 'flyer', storeData?.id, storeData?.name); } catch (_) {}

  let currentPage = 0;
  const title = flyer.title || 'Flyer';
  const dateLabel = formatFlyerDateRange(flyer);

  const modal = document.createElement('div');
  modal.className = 'flyer-modal active';
  modal.innerHTML = `
    <div class="flyer-modal-backdrop" data-close></div>
    <div class="flyer-modal-panel">
      <div class="flyer-modal-header">
        <div class="flyer-modal-header-text">
          <div class="flyer-modal-title">${escapeHtml(title)}</div>
          ${dateLabel ? `<div class="flyer-modal-date">${escapeHtml(dateLabel)}</div>` : ''}
        </div>
        <button class="flyer-modal-close" type="button" aria-label="Close flyer" data-close>
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <div class="flyer-modal-body">
        <button class="flyer-modal-nav flyer-modal-prev" type="button" aria-label="Previous page">
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
        <img class="flyer-modal-image" id="flyerModalImage"
             src="${escapeHtml(pages[0])}"
             alt="${escapeHtml(title)}"
             onerror="this.src='img/placeholder.jpg'" />
        <button class="flyer-modal-nav flyer-modal-next" type="button" aria-label="Next page">
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
        ${pages.length > 1 ? `<div class="flyer-modal-counter" id="flyerModalCounter">1 of ${pages.length}</div>` : ''}
        <div class="flyer-modal-hint">
          <i class="fas fa-hand-pointer" aria-hidden="true"></i>
          Pinch to zoom · long-press to save
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  const imgEl = modal.querySelector('#flyerModalImage');
  const counterEl = modal.querySelector('#flyerModalCounter');
  const prevBtn = modal.querySelector('.flyer-modal-prev');
  const nextBtn = modal.querySelector('.flyer-modal-next');

  const updateNav = () => {
    if (imgEl) imgEl.src = pages[currentPage];
    if (counterEl) counterEl.textContent = `${currentPage + 1} of ${pages.length}`;
    if (prevBtn) {
      const disabled = currentPage === 0;
      prevBtn.disabled = disabled;
      prevBtn.style.visibility = disabled ? 'hidden' : 'visible';
    }
    if (nextBtn) {
      const disabled = currentPage === pages.length - 1;
      nextBtn.disabled = disabled;
      nextBtn.style.visibility = disabled ? 'hidden' : 'visible';
    }
  };
  updateNav();

  prevBtn?.addEventListener('click', () => {
    if (currentPage > 0) { currentPage--; updateNav(); }
  });
  nextBtn?.addEventListener('click', () => {
    if (currentPage < pages.length - 1) { currentPage++; updateNav(); }
  });

  let touchStartX = 0;
  const body = modal.querySelector('.flyer-modal-body');
  if (body && pages.length > 1) {
    body.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    body.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) < 40) return;
      if (dx < 0 && currentPage < pages.length - 1) { currentPage++; updateNav(); }
      else if (dx > 0 && currentPage > 0) { currentPage--; updateNav(); }
    }, { passive: true });
  }

  const keyHandler = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft' && currentPage > 0) { currentPage--; updateNav(); }
    if (e.key === 'ArrowRight' && currentPage < pages.length - 1) { currentPage++; updateNav(); }
  };
  document.addEventListener('keydown', keyHandler);

  const close = () => {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', keyHandler);
    setTimeout(() => modal.remove(), 250);
  };

  modal.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', close);
  });
}

// ============================================================
//  STORE SPECIALS
// ============================================================
function renderStoreSpecials() {
  if (!storeSpecialsSection || !storeSpecialsGrid) return;
  if (!storeSpecials.length) {
    storeSpecialsSection.hidden = true;
    return;
  }
  storeSpecialsSection.hidden = false;

  storeSpecialsGrid.innerHTML = storeSpecials.map(s => {
    const img = s.image || 'img/placeholder.jpg';
    const price = (typeof s.price === 'number') ? s.price.toFixed(2) : '—';
    const oldPrice = (typeof s.oldPrice === 'number' && s.oldPrice > 0)
      ? `<span class="special-card-old">R${s.oldPrice.toFixed(2)}</span>` : '';
    const tag = s.tag ? `<span class="special-card-tag">${escapeHtml(s.tag)}</span>` : '';
    const badge = s.timeStatus === 'ending_soon'
      ? `<span class="special-time-badge ending"><i class="fas fa-clock"></i> ${s.daysLeft}d left</span>` : '';

    // Check if this special corresponds to an out-of-stock product
    const matchedProduct = storeProducts.find(p => p.id === s.productId || p.name === s.item);
    const outOfStock = matchedProduct?.stock === false;

    return `
      <article class="special-card ${outOfStock ? 'is-out-of-stock' : ''}" data-id="${s.id}">
        ${tag}
        ${badge}
        <img class="special-card-img" src="${escapeHtml(img)}" alt="${escapeHtml(s.item || 'Special')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        ${outOfStock
          ? `<div class="special-card-out-badge">Out of Stock</div>`
          : `<button class="special-card-add-btn" type="button" aria-label="Add ${escapeHtml(s.item || 'special')} to cart" data-special-id="${s.id}">
               <i class="fas fa-plus" aria-hidden="true"></i>
             </button>`
        }
        <div class="special-card-body">
          <div class="special-card-store">${escapeHtml(s.store || '')}</div>
          <div class="special-card-name">${escapeHtml(s.item || '')}</div>
          <div class="special-card-prices">
            <span class="special-card-price">R${price}</span>
            ${oldPrice}
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Click the card body → track view + open modal
  storeSpecialsGrid.querySelectorAll('.special-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.special-card-add-btn')) return;
      if (card.classList.contains('is-out-of-stock')) {
        showToast('This special is currently out of stock.');
        return;
      }
      const s = storeSpecials.find(x => x.id === card.dataset.id);
      if (s) {
        // Fire the view tracker (async, non-blocking)
        try { 
          trackSpecialView(s.id, s.item, storeData?.id, storeData?.name); 
        } catch (err) { console.warn('trackSpecialView error:', err); }
        
        openProductModal({
          ...s,
          store: s.store || storeData.name,
          storeName: s.storeName || s.store || storeData.name,
          storeId: s.storeId || storeData.id
        });
      }
    });
  });

  // Click the "+" button → also track view (user is engaging with it)
  storeSpecialsGrid.querySelectorAll('.special-card-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const s = storeSpecials.find(x => x.id === btn.dataset.specialId);
      if (s) {
        // Fire the view tracker here too — this was the missing piece
        try { 
          trackSpecialView(s.id, s.item, storeData?.id, storeData?.name); 
        } catch (err) { console.warn('trackSpecialView error:', err); }
        
        openProductModal({
          ...s,
          store: s.store || storeData.name,
          storeName: s.storeName || s.store || storeData.name,
          storeId: s.storeId || storeData.id
        });
      }
    });
  });
}

// ============================================================
//  CATEGORY FILTER POPULATION
// ============================================================
function populateCategoryFilter() {
  if (!filterCategory) return;

  const previous = filterCategory.value || 'all';
  filterCategory.innerHTML = '<option value="all">All categories</option>';

  const categories = new Set();
  storeProducts.forEach(p => {
    const c = (p.category || '').trim();
    if (c && c.toLowerCase() !== 'uncategorized') categories.add(c);
  });

  Array.from(categories).sort((a, b) => a.localeCompare(b)).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    filterCategory.appendChild(opt);
  });

  if (Array.from(filterCategory.options).some(o => o.value === previous)) {
    filterCategory.value = previous;
    activeCategory = previous;
  } else {
    filterCategory.value = 'all';
    activeCategory = 'all';
  }
}

// ============================================================
//  BROWSE ITEMS
// ============================================================
function renderBrowseItems() {
  if (!browseGrid) return;

  let sorted = [...storeProducts];
  sorted = applySort(sorted, activeSort);

  filteredProducts = sorted;
  applySearchAndCategoryFilter();

  if (!sorted.length) {
    browseGrid.innerHTML = '';
    browseEmpty.hidden = false;
    browseCount.textContent = '';
    if (browseEmptyText) browseEmptyText.textContent = "This store hasn't listed any items yet. Check back soon.";
    return;
  }
  browseEmpty.hidden = true;
}

function applySort(list, mode) {
  const out = [...list];
  switch (mode) {
    case 'price-desc':
      out.sort((a, b) => getActivePrice(b) - getActivePrice(a));
      break;
    case 'name-asc':
      out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    case 'name-desc':
      out.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
      break;
    case 'price-asc':
    default:
      out.sort((a, b) => getActivePrice(a) - getActivePrice(b));
      break;
  }
  return out;
}

function applySearchAndCategoryFilter() {
  const q = (searchInput?.value || '').trim().toLowerCase();

  let matches = filteredProducts;

  if (activeCategory !== 'all') {
    matches = matches.filter(p => (p.category || '') === activeCategory);
  }

  if (q) {
    matches = matches.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.desc || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }

  renderBrowseGrid(matches);

  if (browseCount) {
    const total = filteredProducts.length;
    const parts = [];
    if (activeCategory !== 'all') parts.push(`category "${activeCategory}"`);
    if (q) parts.push(`matching "${q}"`);

    if (parts.length) {
      browseCount.textContent = `${matches.length} of ${total} item${total === 1 ? '' : 's'} — ${parts.join(', ')}`;
    } else {
      browseCount.textContent = `${total} item${total === 1 ? '' : 's'}`;
    }
  }

  if (!matches.length) {
    if (browseGrid) browseGrid.innerHTML = '';
    if (browseEmpty) browseEmpty.hidden = false;
    if (browseEmptyText) {
      if (q && activeCategory !== 'all') {
        browseEmptyText.textContent = `No items match "${q}" in ${activeCategory}.`;
      } else if (q) {
        browseEmptyText.textContent = `No items match "${q}" in this store.`;
      } else if (activeCategory !== 'all') {
        browseEmptyText.textContent = `No items in the "${activeCategory}" category yet.`;
      } else {
        browseEmptyText.textContent = "This store hasn't listed any items yet. Check back soon.";
      }
    }
  } else {
    if (browseEmpty) browseEmpty.hidden = true;
  }
}

function renderBrowseGrid(items) {
  if (!browseGrid) return;

  let html = items.map(p => renderItemCard(p)).join('');

  html += `
    <article class="browse-item-card request-tile" id="requestItemTile" role="listitem">
      <div class="request-tile-icon">
        <i class="fas fa-lightbulb" aria-hidden="true"></i>
      </div>
      <div class="request-tile-label">Can't find an item?</div>
      <div class="request-tile-sub">Let us know and we'll try to add it.</div>
    </article>
  `;

  browseGrid.innerHTML = html;

  browseGrid.querySelectorAll('.browse-item-card:not(.request-tile)').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.browse-item-add-btn')) return;
      if (card.classList.contains('is-out-of-stock')) {
        showToast('This item is currently out of stock.');
        return;
      }
      const id = card.dataset.id;
      const product = storeProducts.find(x => x.id === id);
      if (product) {
        try { trackProductView(id, product.name, storeData?.id, storeData?.name, 'store-page'); } catch (_) {}
        openProductModal(decorateProduct(product));
      }
    });
  });

  browseGrid.querySelectorAll('.browse-item-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const product = storeProducts.find(x => x.id === id);
      if (product) openProductModal(decorateProduct(product));
    });
  });

  document.getElementById('requestItemTile')?.addEventListener('click', () => {
    openRequestModal();
  });
}

function renderItemCard(p) {
  const img = p.image || 'img/placeholder.jpg';
  const activePrice = getActivePrice(p);
  const basePrice = Number(p.price) || 0;
  const isSpecial = activePrice !== basePrice && p.onSpecial === true;
  const inStock = p.stock !== false;

  const priceHtml = isSpecial && inStock
    ? `<div class="browse-item-prices">
         <span class="browse-item-price">R${activePrice.toFixed(2)}</span>
         <span class="browse-item-old">R${basePrice.toFixed(2)}</span>
       </div>`
    : `<div class="browse-item-prices">
         <span class="browse-item-price ${!inStock ? 'is-out-of-stock' : ''}">${inStock ? 'R' + basePrice.toFixed(2) : 'Out of stock'}</span>
       </div>`;

  const desc = (p.desc || p.description || '').trim();

  return `
    <article class="browse-item-card ${!inStock ? 'is-out-of-stock' : ''}" data-id="${p.id}" role="listitem">
      <div class="browse-item-img-wrap">
        <img class="browse-item-img" src="${escapeHtml(img)}" alt="${escapeHtml(p.name || 'Product')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        ${isSpecial && inStock ? `<span class="browse-item-special-badge"><i class="fas fa-bolt" aria-hidden="true"></i> Special</span>` : ''}
        ${inStock
          ? `<button class="browse-item-add-btn" type="button" aria-label="Add ${escapeHtml(p.name || 'item')} to cart" data-id="${p.id}">
               <i class="fas fa-plus" aria-hidden="true"></i>
             </button>`
          : `<span class="browse-item-out">Out of stock</span>`
        }
      </div>
      <div class="browse-item-body">
        <div class="browse-item-name">${escapeHtml(p.name || 'Product')}</div>
        ${desc ? `<div class="browse-item-desc">${escapeHtml(desc)}</div>` : ''}
        ${p.weight ? `<div class="browse-item-weight">${escapeHtml(p.weight)}</div>` : ''}
        ${priceHtml}
      </div>
    </article>
  `;
}

// ============================================================
//  SEARCH + FILTERS
// ============================================================
function initSearch() {
  if (!searchInput || !searchClear) return;

  let debounce = null;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    searchClear.hidden = q.trim().length === 0;

    clearTimeout(debounce);
    debounce = setTimeout(() => applySearchAndCategoryFilter(), 180);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    applySearchAndCategoryFilter();
    searchInput.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.blur();
    }
  });

  filterCategory?.addEventListener('change', () => {
    activeCategory = filterCategory.value || 'all';
    applySearchAndCategoryFilter();
  });

  sortBy?.addEventListener('change', () => {
    activeSort = sortBy.value || 'price-asc';
    renderBrowseItems();
  });
}

// ============================================================
//  REQUEST-AN-ITEM
// ============================================================
function initRequestItemFeature() {
  requestItemBtn?.addEventListener('click', openRequestModal);

  requestItemModal?.querySelectorAll('[data-request-close]').forEach(el => {
    el.addEventListener('click', closeRequestModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && requestItemModal?.classList.contains('open')) {
      closeRequestModal();
    }
  });

  prefillRequestContact();
  if (auth && typeof auth.onAuthStateChanged === 'function') {
    auth.onAuthStateChanged(() => prefillRequestContact());
  }

  requestSubmitBtn?.addEventListener('click', submitItemRequest);
}

function prefillRequestContact() {
  if (!requestContact) return;
  if (requestContact.value && requestContact.value.trim()) return;

  const user = auth?.currentUser;
  if (!user) return;

  const phone = user.phoneNumber || '';
  const local = phoneToLocalDigits(phone);
  if (local) requestContact.value = '0' + local;
}

function phoneToLocalDigits(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

function openRequestModal() {
  if (!requestItemModal) return;

  if (requestItemName) requestItemName.value = '';
  if (requestItemNote) requestItemNote.value = '';
  if (requestNotifyMe) requestNotifyMe.checked = true;

  prefillRequestContact();

  requestItemModal.hidden = false;
  requestAnimationFrame(() => requestItemModal.classList.add('open'));
  document.body.style.overflow = 'hidden';

  setTimeout(() => requestItemName?.focus(), 300);
}

function closeRequestModal() {
  if (!requestItemModal) return;
  requestItemModal.classList.remove('open');
  setTimeout(() => {
    requestItemModal.hidden = true;
    document.body.style.overflow = '';
  }, 250);
}

async function submitItemRequest() {
  const itemName = (requestItemName?.value || '').trim();
  const note = (requestItemNote?.value || '').trim();
  const contact = (requestContact?.value || '').trim();
  const notify = requestNotifyMe ? requestNotifyMe.checked : true;

  if (!itemName) {
    showToast('Please type the name of the item you are looking for.');
    requestItemName?.focus();
    return;
  }

  const contactDigits = contact.replace(/\D/g, '');
  if (contactDigits.length < 9) {
    showToast('Please enter your mobile number so we can text you when it\'s in.');
    requestContact?.focus();
    return;
  }

  requestSubmitBtn.disabled = true;
  requestSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> <span>Sending...</span>';

  try {
    const user = auth?.currentUser;
    const payload = {
      itemName,
      note,
      contact,
      notifyMe: notify,
      storeName: storeData?.name || '',
      storeId: storeData?.id || '',
      customerId: user?.uid || null,
      customerPhone: user?.phoneNumber || '',
      status: 'pending',
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'itemRequests'), payload);

    showToast('✅ Thank you! We got your request.');
    closeRequestModal();
  } catch (err) {
    console.error('Item request error:', err);
    showToast('Could not send. Please try again.');
  } finally {
    requestSubmitBtn.disabled = false;
    requestSubmitBtn.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> <span>Send request</span>';
  }
}

// ============================================================
//  BACK TO TOP
// ============================================================
function initBackToTop() {
  if (!backToTop) return;

  const toggle = () => {
    if (window.scrollY > 400) backToTop.classList.add('show');
    else backToTop.classList.remove('show');
  };

  window.addEventListener('scroll', toggle, { passive: true });
  toggle();

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

window.openNotificationModal = openNotificationModal;