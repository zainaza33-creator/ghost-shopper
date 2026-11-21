// ============================================================
//  stores.js — Ghost Shopper Stores page (mall directory)
//  Dual-mode search (Stores / Items), categories rail,
//  weekly specials rail, new arrivals rail, cart modal.
//  Item cards now show the active special price when one is live.
//  Store-request tile added at end of the store grid.
//  "New on Ghost Shopper" rail now only shows stores created
//  in the last 30 days.
// ============================================================

console.log('🚀 stores.js booting...');

import {
  db,
  getDocs,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from './firebase-config.js';

import {
  initGlobal,
  showToast,
  updateCartBadge,
  getCart,
  updateAuthIconState,
  openNotificationModal
} from './global.js';

import { openProductModal, setProductModalData } from './product-modal.js';
import { openCarouselModal } from './carousel-modal.js';
import { getActivePrice } from './cart-utils.js';
import { getStoreStatus, isStoreOpenNow } from './hours-utils.js';
import { initStoreRequest, buildStoreRequestTileHtml, wireStoreRequestTile } from './store-request.js';
import { getCatalog, getSpecialsCache } from './catalog-cache.js';

// ===== DOM =====
const loadingScreen = document.getElementById('loadingScreen');
const storesGrid = document.getElementById('storesGrid');
const itemsResultsGrid = document.getElementById('itemsResultsGrid');
const storesSearchInput = document.getElementById('storesSearchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
const filterTabs = document.querySelectorAll('.stores-filter-bar .filter-tab');
const storesFilterBar = document.getElementById('storesFilterBar');
const resultCountText = document.getElementById('resultCountText');
const noResults = document.getElementById('noResults');
const noResultsText = document.getElementById('noResultsText');
const modeBtns = document.querySelectorAll('.mode-btn');
const storesCatsRail = document.getElementById('storesCatsRail');
const storesSpecialsSection = document.getElementById('storesSpecialsSection');
const storesSpecialsRail = document.getElementById('storesSpecialsRail');
const storesNewSection = document.getElementById('storesNewSection');
const storesNewRail = document.getElementById('storesNewRail');

// ===== STATE =====
let storesData = [];
let allProducts = [];
let allSpecials = [];
let currentFilter = 'all';
let currentMode = 'stores';
let deliveryFee = 35;
let searchTimeout = null;
let storesLoaded = false;

const MAX_NEW_STORES = 5;
// A store stays "New" for this many days after its createdAt date.
// After that it disappears from the "New on Ghost Shopper" rail.
const NEW_STORE_WINDOW_DAYS = 30;

// ============================================================
//  BOOTSTRAP
// ============================================================
window.addEventListener('load', () => {
  console.log('✅ Window loaded, bootstrapping stores page');

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

  // Store request modal — wire everything once
  try { initStoreRequest(); } catch (err) { console.warn('store-request init error:', err); }

  updateCartBadge();
  updateAuthIconState();
  loadDeliveryFee();
  loadStoresAndProducts();
  loadSpecials();
  setupListeners();
  setupCategoryRail();
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
      if (storesLoaded) renderStores();
    }
  }, (error) => {
    console.warn('Error loading delivery fee:', error);
  });
}

// ============================================================
//  LOAD STORES + PRODUCTS
// ============================================================
async function loadStoresAndProducts() {
  try {
    const { stores, products } = await getCatalog();
    
    storesData = stores.map(store => {
      const status = getStoreStatus(store);
      return {
        id: store.id,
        ...store,
        image: store.logo || store.image || 'img/placeholder.jpg',
        hours: store.hours || 'Mon-Sat 8am-6pm',
        isOpen: isStoreOpenNow(store),
        _status: status,
        _closed: status.state === 'closed',
        products: [] // Will populate below
      };
    });

    // Map products to their stores
    allProducts = [];
    products.forEach(product => {
      const store = storesData.find(s => s.id === product.storeId);
      if (!store) return;
      
      const enriched = {
        id: product.id,
        ...product,
        storeName: store.name,
        storeId: store.id,
        storeImage: store.image
      };
      store.products.push(enriched);
      allProducts.push(enriched);
    });

    storesLoaded = true;

    setProductModalData({ stores: storesData, products: allProducts });
    renderNewArrivals();
    renderStores();
    updateResultsCount();

  } catch (error) {
    console.error('Error loading stores:', error);
    showToast('Error loading stores. Please refresh.');
  }
}

// ============================================================
//  LOAD SPECIALS (rail)
// ============================================================
async function loadSpecials() {
  try {
    let snap;
    try {
      const q1 = query(
        collection(db, 'specials'),
        where('active', '!=', false),
        orderBy('active'),
        orderBy('createdAt', 'desc'),
        limit(100)
      );
      snap = await getDocs(q1);
    } catch (_) {
      const q2 = query(collection(db, 'specials'), orderBy('createdAt', 'desc'), limit(100));
      snap = await getDocs(q2);
    }

    allSpecials = [];
    const now = new Date();
    snap.forEach(d => {
      const data = d.data();
      if (data.active === false) return;

      if (data.endDate) {
        // Handle both Firestore Timestamps and plain string dates
        let end;
        if (typeof data.endDate === 'string') {
          end = new Date(data.endDate + 'T23:59:59');
        } else {
          end = data.endDate.toDate ? data.endDate.toDate() : new Date(data.endDate);
        }
        
        if (!isNaN(end)) {
          // Force end time to 23:59:59 on that day
          end.setHours(23, 59, 59, 999);
          if (end < now) return;
        }
      }

      allSpecials.push({ id: d.id, ...data });
    });

    console.log('📢 Stores page specials loaded:', allSpecials.length);
    renderSpecialsRail();
  } catch (err) {
    console.warn('Specials load failed:', err);
  }
}

function renderSpecialsRail() {
  if (!storesSpecialsRail || !storesSpecialsSection) return;
  if (!allSpecials.length) {
    storesSpecialsSection.hidden = true;
    return;
  }

  storesSpecialsSection.hidden = false;

  const railHead = storesSpecialsSection.querySelector('.stores-rail-head');
  if (railHead && allSpecials.length > 10) {
    let seeAllBtn = railHead.querySelector('.stores-rail-see-all');
    if (!seeAllBtn) {
      seeAllBtn = document.createElement('button');
      seeAllBtn.type = 'button';
      seeAllBtn.className = 'stores-rail-see-all';
      seeAllBtn.innerHTML = `See All <i class="fas fa-arrow-right" aria-hidden="true"></i>`;
      seeAllBtn.addEventListener('click', openStoresPageSpecialsCarousel);
      railHead.appendChild(seeAllBtn);
    } else {
      seeAllBtn.onclick = openStoresPageSpecialsCarousel;
    }
    seeAllBtn.hidden = false;
  }

  storesSpecialsRail.innerHTML = allSpecials.slice(0, 10).map(s => {
    const img = s.image || 'img/placeholder.jpg';
    const price = (typeof s.price === 'number') ? s.price.toFixed(2) : '—';
    const oldPrice = (typeof s.oldPrice === 'number' && s.oldPrice > 0)
      ? `<span class="special-card-old">R${s.oldPrice.toFixed(2)}</span>` : '';
    const tag = s.tag ? `<span class="special-card-tag">${escapeHtml(s.tag)}</span>` : '';

    return `
      <article class="special-card" data-id="${s.id}">
        ${tag}
        <img class="special-card-img" src="${escapeHtml(img)}" alt="${escapeHtml(s.item || 'Special')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        <button class="special-card-add-btn" type="button" aria-label="Add ${escapeHtml(s.item || 'special')} to cart" data-special-id="${s.id}">
          <i class="fas fa-plus" aria-hidden="true"></i>
        </button>
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

  storesSpecialsRail.querySelectorAll('.special-card').forEach(card => {
    card.addEventListener('click', () => {
      const special = allSpecials.find(s => s.id === card.dataset.id);
      if (special) openProductModal(special);
    });
  });

  storesSpecialsRail.querySelectorAll('.special-card-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const special = allSpecials.find(s => s.id === btn.dataset.specialId);
      if (special) openProductModal(special);
    });
  });
}

// ============================================================
//  NEW ARRIVALS — only shows stores created in the last N days
// ============================================================
function renderNewArrivals() {
  if (!storesNewRail || !storesNewSection) return;

  const now = Date.now();
  const windowMs = NEW_STORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const withDates = storesData
    .map(s => ({
      ...s,
      _createdAt: s.createdAt?.toDate ? s.createdAt.toDate().getTime() : 0
    }))
    .filter(s => s._createdAt > 0)
    // Only stores created within the last NEW_STORE_WINDOW_DAYS days.
    .filter(s => s._createdAt >= cutoff)
    .sort((a, b) => b._createdAt - a._createdAt);

  const newest = withDates.slice(0, MAX_NEW_STORES);

  if (newest.length < 1) {
    // No store qualifies as "new" — hide the whole section.
    storesNewSection.hidden = true;
    storesNewRail.innerHTML = '';
    return;
  }

  storesNewSection.hidden = false;

  storesNewRail.innerHTML = newest.map(store => {
    // Generate the slug
    const storeSlug = (store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    return `
      <a class="stores-new-card" href="/store/${storeSlug}" role="listitem">
        <img class="stores-new-logo" src="${escapeHtml(store.image)}" alt="${escapeHtml(store.name || '')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        <div class="stores-new-name">${escapeHtml(store.name || 'Store')}</div>
        <span class="stores-new-badge"><i class="fas fa-star" aria-hidden="true"></i> New</span>
      </a>
    `;
  }).join('');
}

// ============================================================
//  HOURS — parsing lives in ./hours-utils.js
// ============================================================

// ============================================================
//  RENDER STORES
// ============================================================
function renderStores() {
  if (currentMode !== 'stores') return;

  const q = (storesSearchInput.value || '').trim().toLowerCase();
  let filtered = [...storesData];

  if (currentFilter !== 'all') {
    if (currentFilter === 'open') {
      filtered = filtered.filter(s => s._status?.state === 'open' || s._status?.state === 'lunch');
    } else {
      filtered = filtered.filter(s => {
        const cats = [];
        if (Array.isArray(s.categories)) cats.push(...s.categories.map(c => String(c).toLowerCase()));
        if (Array.isArray(s.category)) cats.push(...s.category.map(c => String(c).toLowerCase()));
        else if (typeof s.category === 'string' && s.category) cats.push(s.category.toLowerCase());
        return cats.includes(currentFilter);
      });
    }
  }

  if (q) {
    filtered = filtered.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.address || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }

  itemsResultsGrid.style.display = 'none';
  itemsResultsGrid.classList.remove('active');

  // Even with zero stores, show the request tile so customers can ask.
  if (filtered.length === 0) {
    storesGrid.style.display = 'grid';
    storesGrid.classList.remove('hidden');
    storesGrid.innerHTML = buildStoreRequestTileHtml();
    wireStoreRequestTile(storesGrid);

    noResults.style.display = 'none';
    resultCountText.textContent = q
      ? `0 stores found matching "${q}"`
      : '0 stores';
    return;
  }

  noResults.style.display = 'none';
  storesGrid.style.display = 'grid';
  storesGrid.classList.remove('hidden');

  storesGrid.innerHTML = filtered.map(store => {
    const st = store._status?.state || 'closed';
    let statusLabel, statusClass;
    if (st === 'open') { statusLabel = 'Open'; statusClass = 'open'; }
    else if (st === 'lunch') {
      statusLabel = `Closed · back at ${store._status.reopenAt || ''}`;
      statusClass = 'lunch';
    } else { statusLabel = 'Closed'; statusClass = 'closed'; }

    const desc = store.description || '';
    const logo = store.logo || store.image || 'img/placeholder.jpg';
    const lunchStyle = statusClass === 'lunch' ? 'style="background:#FEF3C7;color:#92400E;"' : '';
    
    // Generate the slug
    const storeSlug = (store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    return `
      <a class="store-card" href="/store/${storeSlug}" data-id="${store.id}" role="listitem">
        <img class="store-card-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(store.name || '')} logo" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        <div class="store-card-body">
          <div class="store-card-name">${escapeHtml(store.name || 'Store')}</div>
          ${desc ? `<div class="store-card-desc">${escapeHtml(desc)}</div>` : ''}
          <div class="store-card-meta">
            <span class="store-card-badge ${statusClass}" ${lunchStyle}>${statusLabel}</span>
            <span>Delivery R${deliveryFee.toFixed(2)}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');

  // Append the store-request tile at the end.
  const requestWrapper = document.createElement('div');
  requestWrapper.innerHTML = buildStoreRequestTileHtml();
  const requestTile = requestWrapper.firstElementChild;
  storesGrid.appendChild(requestTile);

  wireStoreRequestTile(storesGrid);

  updateResultsCount();
}

// ============================================================
//  RENDER ITEMS — special-aware pricing
// ============================================================
function renderItems(query) {
  if (currentMode !== 'items') return;

  storesGrid.style.display = 'none';
  storesGrid.classList.add('hidden');

  if (!query || query.length < 2) {
    itemsResultsGrid.style.display = 'none';
    itemsResultsGrid.classList.remove('active');
    noResults.style.display = 'none';
    resultCountText.textContent = 'Type at least 2 characters to search items';
    return;
  }

  let matches = allProducts.filter(p =>
    p.stock !== false && (
      (p.name || '').toLowerCase().includes(query) ||
      (p.desc || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query)
    )
  );

  matches.sort((a, b) => getActivePrice(a) - getActivePrice(b));

  if (matches.length === 0) {
    itemsResultsGrid.style.display = 'none';
    itemsResultsGrid.classList.remove('active');
    noResults.style.display = 'block';
    noResultsText.textContent = `No items found matching "${query}"`;
    resultCountText.textContent = '0 items';
    return;
  }

  noResults.style.display = 'none';
  itemsResultsGrid.style.display = 'grid';
  itemsResultsGrid.classList.add('active');

  itemsResultsGrid.innerHTML = matches.map(item => {
    const activePrice = getActivePrice(item);
    const basePrice = Number(item.price) || 0;
    const isSpecial = activePrice !== basePrice && item.onSpecial === true;

    const priceHtml = isSpecial
      ? `<div class="item-price">
           <span class="item-price-now">R${activePrice.toFixed(2)}</span>
           <span class="item-price-old">R${basePrice.toFixed(2)}</span>
         </div>`
      : `<div class="item-price">R${basePrice.toFixed(2)}</div>`;

    return `
      <div class="item-result-card" data-id="${item.id}" data-store-id="${item.storeId}" role="listitem">
        <div class="item-img">
          <img src="${escapeHtml(item.image || 'img/placeholder.jpg')}" alt="${escapeHtml(item.name || '')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
          ${isSpecial ? `<span class="item-card-special-badge"><i class="fas fa-bolt"></i> Special</span>` : ''}
          ${item.stock !== false
            ? `<button class="item-card-add-btn" type="button" data-id="${item.id}" aria-label="Add ${escapeHtml(item.name || 'item')} to cart"><i class="fas fa-plus" aria-hidden="true"></i></button>`
            : `<span class="item-card-out-stock">Out of Stock</span>`
          }
        </div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(item.name || 'Product')}</div>
          <div class="item-store-name"><i class="fas fa-store" aria-hidden="true"></i> ${escapeHtml(item.storeName || '')}</div>
          ${priceHtml}
        </div>
      </div>
    `;
  }).join('');

  resultCountText.textContent = `${matches.length} items found`;

  itemsResultsGrid.querySelectorAll('.item-result-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.item-card-add-btn')) return;
      if (e.target.closest('.item-card-out-stock')) return;
      const itemId = card.dataset.id;
      const product = allProducts.find(p => p.id === itemId);
      if (product) openProductModal(product);
    });
  });

  itemsResultsGrid.querySelectorAll('.item-card-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      const product = allProducts.find(p => p.id === itemId);
      if (product) openProductModal(product);
    });
  });
}

// ============================================================
//  RESULTS COUNT
// ============================================================
function updateResultsCount() {
  if (currentMode !== 'stores') return;
  // Count only actual store cards, not the request tile.
  const count = storesGrid.querySelectorAll('.store-card:not(.store-request-tile)').length;
  if (count > 0) {
    resultCountText.textContent = `${count} store${count === 1 ? '' : 's'} found`;
  }
}

// ============================================================
//  CATEGORY RAIL
// ============================================================
function setupCategoryRail() {
  if (!storesCatsRail) return;
  storesCatsRail.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat || 'all';

      if (currentFilter === cat && cat !== 'all') {
        currentFilter = 'all';
      } else {
        currentFilter = cat;
      }

      syncCategoryChips();
      syncFilterTabs();

      if (currentMode !== 'stores') {
        const storesBtn = document.querySelector('.mode-btn[data-mode="stores"]');
        if (storesBtn) storesBtn.click();
      } else {
        renderStores();
      }

      const searchSection = document.querySelector('.stores-search-section');
      if (searchSection) searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function syncCategoryChips() {
  if (!storesCatsRail) return;
  storesCatsRail.querySelectorAll('.cat-chip').forEach(chip => {
    const isActive = (chip.dataset.cat || 'all') === currentFilter;
    chip.classList.toggle('active', isActive);
  });
}

function syncFilterTabs() {
  filterTabs.forEach(tab => {
    const isActive = (tab.dataset.filter || 'all') === currentFilter;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

// ============================================================
//  LISTENERS
// ============================================================
function setupListeners() {
  storesSearchInput.addEventListener('input', function() {
    const q = this.value.trim();
    searchClearBtn.hidden = q.length === 0;

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const lower = q.toLowerCase();
      if (currentMode === 'stores') {
        renderStores();
      } else {
        renderItems(lower);
      }
    }, 250);
  });

  searchClearBtn.addEventListener('click', () => {
    storesSearchInput.value = '';
    searchClearBtn.hidden = true;
    if (currentMode === 'stores') {
      renderStores();
    } else {
      renderItems('');
    }
    storesSearchInput.focus();
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentMode = btn.dataset.mode;

      noResults.style.display = 'none';

      if (currentMode === 'stores') {
        storesFilterBar.style.display = 'flex';
        itemsResultsGrid.style.display = 'none';
        itemsResultsGrid.classList.remove('active');
        storesGrid.style.display = 'grid';
        storesGrid.classList.remove('hidden');
        storesSearchInput.placeholder = 'Search stores by name or area...';
        renderStores();
      } else {
        storesFilterBar.style.display = 'none';
        storesGrid.style.display = 'none';
        storesGrid.classList.add('hidden');
        itemsResultsGrid.style.display = 'none';
        itemsResultsGrid.classList.remove('active');
        storesSearchInput.placeholder = 'Search for items (e.g. bread, milk)...';
        resultCountText.textContent = 'Type at least 2 characters to search items';

        const q = storesSearchInput.value.trim().toLowerCase();
        if (q.length >= 2) {
          renderItems(q);
        }
      }
    });
  });

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter || 'all';
      syncFilterTabs();
      syncCategoryChips();
      if (currentMode === 'stores') renderStores();
    });
  });
}

// ============================================================
//  SEE ALL — Specials carousel
// ============================================================
function openStoresPageSpecialsCarousel() {
  // Use allSpecials (which now contains all 72)
  const items = allSpecials.map((s) => ({
    id: s.id,
    title: s.item || '',
    subtitle: s.store || '',
    image: s.image || 'img/placeholder.jpg',
    price: typeof s.price === 'number' ? `R${s.price.toFixed(2)}` : '',
    oldPrice: (typeof s.oldPrice === 'number' && s.oldPrice > 0) ? `R${s.oldPrice.toFixed(2)}` : '',
    tag: s.tag || 'Special',
    searchText: `${s.item || ''} ${s.store || ''} ${s.tag || ''}`.toLowerCase(),
    kind: 'special',
    special: s,
    ctaLabel: 'View & Add to Cart'
  }));

  openCarouselModal({
    title: 'All Specials',
    placeholder: 'Search specials by item or store...',
    items,
    emptyText: 'No specials match your search.',
    onItemTap: (item) => {
      if (item.kind === 'special' && item.special) {
        openProductModal(item.special);
      }
    }
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