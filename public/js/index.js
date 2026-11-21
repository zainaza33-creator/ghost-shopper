// ============================================================
//  index.js — Ghost Shopper homepage
//  Loader, hero search, specials, categories, stores, FAQ,
//  install sheet, announcement sheet, back-to-top,
//  See More tiles + modals for specials & stores.
//  Product modal is now imported from product-modal.js (shared).
//  Store-request tile + modal now imported from store-request.js.
// ============================================================

console.log('🚀 index.js booting...');

import { auth, db } from './firebase-config.js';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  initGlobal,
  showToast,
  getSavedAddress,
  saveAddress,
  getCart
} from './global.js';

import { mixSpecialsByCategory } from './cart-utils.js';
import { getStoreStatus, isStoreOpenNow } from './hours-utils.js';
import { initStoreRequest, buildStoreRequestTileHtml, wireStoreRequestTile } from './store-request.js';
import { getSpecialsCache } from './catalog-cache.js';

import { openProductModal, setProductModalData } from './product-modal.js';
import { openCarouselModal, closeCarouselModal } from './carousel-modal.js';

// Track homepage visit for admin online-users counter
import('./analytics.js').then(mod => {
  if (mod && mod.trackPageView) {
    try { mod.trackPageView(); } catch (_) {}
  }
}).catch(() => {});

// ---- SAFETY: force-hide loader ----
const LOADER_CEILING_MS = 6000;
let loaderHidden = false;

function hideLoader() {
  if (loaderHidden) return;
  loaderHidden = true;
  const el = document.getElementById('loadingScreen');
  if (!el) return;
  el.classList.add('hidden');
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

window.addEventListener('load', () => {
  setTimeout(hideLoader, LOADER_CEILING_MS);
});

// ============================================================
//  CONSTANTS
// ============================================================
const CATEGORIES = [
  { id: 'all',         label: 'All',         icon: 'fa-th-large' },
  { id: 'supermarket', label: 'Supermarket', icon: 'fa-shopping-basket' },
  { id: 'butchery',    label: 'Butchery',    icon: 'fa-drumstick-bite' },
  { id: 'bakery',      label: 'Bakery',      icon: 'fa-bread-slice' },
  { id: 'pharmacy',    label: 'Pharmacy',    icon: 'fa-prescription-bottle-medical' }
];

const MAX_VISIBLE_ON_HOMEPAGE = 10;

// ============================================================
//  STATE
// ============================================================
let allStores = [];
let allSpecials = [];
window._gsAllSpecials = []; // Global fallback for mobile bfcache
let allProducts = [];
let deliveryAreas = [];
let currentStoreFilter = 'all';
let mapsLoaded = false;
let mapsLoading = false;

// ============================================================
//  BOOTSTRAP
// ============================================================
window.addEventListener('load', () => {
  console.log('✅ Window loaded, bootstrapping homepage');

  try {
    const p = initGlobal();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.warn('initGlobal error (non-fatal):', err));
    }
  } catch (err) {
    console.warn('initGlobal threw (non-fatal):', err);
  }

  try { initHeroSearch(); } catch (err) { console.warn('hero search error:', err); }

  // Store request modal — wire everything once
  try { initStoreRequest(); } catch (err) { console.warn('store-request init error:', err); }

  loadDeliveryAreas().catch(err => console.warn('areas load error:', err));
  loadSpecials().catch(err => console.warn('specials load error:', err));
  try { renderCategories(); } catch (err) { console.warn('categories error:', err); }
  loadStores().catch(err => console.warn('stores load error:', err));
  // loadProducts() removed

  try { initFAQ(); } catch (err) { console.warn('FAQ error:', err); }
  try { initNewsletter(); } catch (err) { console.warn('Newsletter error:', err); }
  try { initInstallSheet(); } catch (err) { console.warn('install sheet error:', err); }
  try { initAnnouncementSheet(); } catch (err) { console.warn('announcement error:', err); }
  try { initBackToTop(); } catch (err) { console.warn('back-to-top error:', err); }
  try { initPartnerModal(); } catch (err) { console.warn('partner modal error:', err); }

  markCriticalReadyWhenReady();
});

function markCriticalReadyWhenReady() {
  const check = () => {
    const hasNav    = !!document.querySelector('.navbar');
    const hasHero   = !!document.querySelector('.hero h1');
    const hasSearch = !!document.getElementById('heroAddressInput');
    if (hasNav && hasHero && hasSearch) {
      hideLoader();
    } else {
      setTimeout(check, 100);
    }
  };
  setTimeout(check, 200);
}

// ============================================================
//  1. GOOGLE MAPS LOADER
// ============================================================
function loadGoogleMaps() {
  if (mapsLoaded || mapsLoading) return;
  mapsLoading = true;

  const key = window.__ENV?.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn('⚠️ Google Maps key missing');
    mapsLoading = false;
    return;
  }

  window.__gsMapsReady = () => {
    mapsLoaded = true;
    mapsLoading = false;
    console.log('✅ Google Maps + Places ready');
    try {
      if (window.google && google.maps && google.maps.places) {
        heroAutocomplete = new google.maps.places.AutocompleteService();
      }
    } catch (err) {
      console.warn('Could not init hero autocomplete:', err);
    }
    try {
      if (typeof window.initAddressSearch === 'function') {
        window.initAddressSearch();
      }
    } catch (err) {
      console.warn('initAddressSearch after maps load:', err);
    }
  };

  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async&callback=__gsMapsReady`;
  s.async = true;
  s.defer = true;
  s.onerror = () => {
    mapsLoading = false;
    console.warn('⚠️ Google Maps failed to load');
  };
  document.head.appendChild(s);
}

window.addEventListener('load', () => {
  setTimeout(loadGoogleMaps, 1000);
});

// ============================================================
//  2. HERO ADDRESS SEARCH
// ============================================================
let heroAutocomplete = null;
let heroPlacesService = null;
let heroPredictions = [];
let heroSelectedIndex = -1;
let heroDebounceTimer = null;

function initHeroSearch() {
  const heroBox     = document.getElementById('heroSearch');
  const heroInput   = document.getElementById('heroAddressInput');
  const heroClear   = document.getElementById('heroSearchClear');
  const heroSuggest = document.getElementById('heroAddressSuggestions');
  const heroBtn     = document.getElementById('heroSearchBtn');

  if (!heroInput || !heroSuggest) {
    console.warn('Hero search: required elements missing');
    return;
  }

  try {
    const saved = (typeof getSavedAddress === 'function') ? getSavedAddress() : '';
    if (saved) {
      heroInput.value = saved;
      if (heroClear) heroClear.hidden = false;
    }
  } catch (_) {}

  heroInput.addEventListener('focus', () => {
    loadGoogleMaps();
    if (heroBox) heroBox.classList.add('hint-hidden');
  });
  heroInput.addEventListener('blur', () => {
    if (heroInput.value.trim() === '' && heroBox) {
      heroBox.classList.remove('hint-hidden');
    }
  });
  heroInput.addEventListener('click', loadGoogleMaps);

  heroInput.addEventListener('input', () => {
    const val = heroInput.value;
    if (heroClear) heroClear.hidden = val.length === 0;

    clearTimeout(heroDebounceTimer);
    if (val.trim().length < 2) {
      closeHeroSuggestions();
      return;
    }

    heroDebounceTimer = setTimeout(() => {
      fetchHeroPredictions(val);
    }, 180);
  });

  heroInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveHeroSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveHeroSelection(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (heroSelectedIndex >= 0 && heroPredictions[heroSelectedIndex]) {
        pickHeroPrediction(heroPredictions[heroSelectedIndex]);
      } else {
        checkAddressAvailability();
      }
    } else if (e.key === 'Escape') {
      closeHeroSuggestions();
      heroInput.blur();
    }
  });

  if (heroClear) {
    heroClear.addEventListener('click', (e) => {
      e.preventDefault();
      heroInput.value = '';
      if (heroSuggest) { heroSuggest.innerHTML = ''; heroSuggest.classList.remove('active'); }
      if (heroClear) heroClear.hidden = true;
      if (heroBox) heroBox.classList.remove('hint-hidden');
      try { saveAddress(''); } catch (_) {}
      heroInput.focus();
    });
  }

  if (heroBtn) {
    heroBtn.addEventListener('click', (e) => {
      e.preventDefault();
      checkAddressAvailability();
    });
  }

  heroSuggest.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    const idx = parseInt(item.dataset.index, 10);
    if (!isNaN(idx) && heroPredictions[idx]) {
      pickHeroPrediction(heroPredictions[idx]);
    } else if (item.dataset.description) {
      heroInput.value = item.dataset.description;
      if (heroClear) heroClear.hidden = false;
      closeHeroSuggestions();
      checkAddressAvailability();
    }
  });

  document.addEventListener('click', (e) => {
    if (!heroBox) return;
    if (!heroBox.contains(e.target)) closeHeroSuggestions();
  });
}

function fetchHeroPredictions(query) {
  if (!window.google || !google.maps || !google.maps.places) {
    if (!mapsLoaded) {
      loadGoogleMaps();
      setTimeout(() => fetchHeroPredictions(query), 400);
    }
    return;
  }

  if (!heroAutocomplete) {
    try {
      heroAutocomplete = new google.maps.places.AutocompleteService();
    } catch (err) {
      console.warn('Could not create AutocompleteService:', err);
      return;
    }
  }

  heroAutocomplete.getPlacePredictions(
    {
      input: query,
      componentRestrictions: { country: 'za' },
      types: ['geocode', 'establishment']
    },
    (predictions, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
        closeHeroSuggestions();
        return;
      }
      heroPredictions = predictions;
      renderHeroSuggestions(predictions);
    }
  );
}

function renderHeroSuggestions(predictions) {
  const heroSuggest = document.getElementById('heroAddressSuggestions');
  if (!heroSuggest) return;

  if (!predictions.length) { closeHeroSuggestions(); return; }

  heroSuggest.innerHTML = predictions.slice(0, 6).map((p, i) => {
    const main = p.structured_formatting?.main_text || p.description;
    const secondary = p.structured_formatting?.secondary_text || '';
    const isVerulam = (p.description || '').toLowerCase().includes('verulam');
    const statusText = isVerulam ? '✅ Available' : '🚧 Coming soon';
    const statusClass = isVerulam ? 'available' : 'unavailable';

    return `
      <div class="suggestion-item" data-index="${i}" data-place-id="${escapeHtml(p.place_id)}" data-description="${escapeHtml(p.description)}" role="option">
        <strong>${escapeHtml(main)}</strong>
        ${secondary ? `<span class="suggestion-secondary">${escapeHtml(secondary)}</span>` : ''}
        <span class="delivery-status ${statusClass}">${statusText}</span>
      </div>
    `;
  }).join('');

  heroSuggest.classList.add('active');
  heroSelectedIndex = -1;
}

function moveHeroSelection(delta) {
  const heroSuggest = document.getElementById('heroAddressSuggestions');
  if (!heroSuggest || !heroPredictions.length) return;

  heroSelectedIndex += delta;
  if (heroSelectedIndex < 0) heroSelectedIndex = heroPredictions.length - 1;
  if (heroSelectedIndex >= heroPredictions.length) heroSelectedIndex = 0;

  const items = heroSuggest.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => el.classList.toggle('active', i === heroSelectedIndex));

  const activeEl = items[heroSelectedIndex];
  if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
}

function pickHeroPrediction(prediction) {
  const heroInput = document.getElementById('heroAddressInput');
  const heroClear = document.getElementById('heroSearchClear');
  if (!heroInput || !prediction) return;

  heroInput.value = prediction.description || '';
  if (heroClear) heroClear.hidden = false;
  try { saveAddress(heroInput.value); } catch (_) {}

  if (window.google && google.maps && google.maps.places && prediction.place_id) {
    if (!heroPlacesService) {
      const dummy = document.createElement('div');
      heroPlacesService = new google.maps.places.PlacesService(dummy);
    }

    heroPlacesService.getDetails(
      { placeId: prediction.place_id, fields: ['formatted_address', 'geometry', 'name', 'address_components'] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          const finalAddr = place.formatted_address || prediction.description;
          heroInput.value = finalAddr;
          try { saveAddress(finalAddr); } catch (_) {}
          closeHeroSuggestions();
          setTimeout(() => checkAddressAvailability(), 100);
        } else {
          closeHeroSuggestions();
          setTimeout(() => checkAddressAvailability(), 100);
        }
      }
    );
  } else {
    closeHeroSuggestions();
    setTimeout(() => checkAddressAvailability(), 100);
  }
}

function closeHeroSuggestions() {
  const heroSuggest = document.getElementById('heroAddressSuggestions');
  if (!heroSuggest) return;
  heroSuggest.classList.remove('active');
  heroSuggest.innerHTML = '';
  heroPredictions = [];
  heroSelectedIndex = -1;
}

// ============================================================
//  2b. ADDRESS AVAILABILITY CHECK
// ============================================================
function checkAddressAvailability() {
  const heroInput = document.getElementById('heroAddressInput');
  if (!heroInput) return;
  const address = (heroInput.value || '').trim();

  if (!address || address.length < 3) {
    showToast('Please enter your delivery address first.');
    heroInput.focus();
    return;
  }

  try { saveAddress(address); } catch (_) {}

  const lower = address.toLowerCase();

  const matched = Array.isArray(deliveryAreas) && deliveryAreas.find(area => {
    if (!area || area.active === false) return false;
    const name = (area.name || '').toLowerCase().trim();
    if (!name) return false;
    return lower.includes(name) || name.includes(lower);
  });

  const fallbackMatch = !matched && lower.includes('verulam');

  if (matched || fallbackMatch) {
    showToast('✅ Great news — we deliver to your area!');
    setTimeout(() => showToast('Tap "Shop Now" to start browsing stores.'), 2200);
  } else {
    showToast("🚧 We don't deliver to this address yet — stay tuned!");
  }
}

// ============================================================
//  3. DELIVERY AREAS
// ============================================================
async function loadDeliveryAreas() {
  try {
    const snap = await getDocs(collection(db, 'areas'));
    deliveryAreas = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.active !== false) deliveryAreas.push({ id: d.id, ...data });
    });
    console.log('📍 Delivery areas loaded:', deliveryAreas.length);
  } catch (err) {
    console.warn('Could not load delivery areas:', err);
    deliveryAreas = [];
  }
}

// ============================================================
//  3b. PRODUCTS (Removed - saves 500 reads per visit)
//  The homepage modal uses the specials mirror data instead.
// ============================================================

// ============================================================
//  4. SPECIALS
// ============================================================
async function loadSpecials() {
  const grid = document.getElementById('specialsGrid');
  if (!grid) return;

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
    
    console.log('📢 Specials loaded:', allSpecials.length);
    setProductModalData({ stores: allStores, products: allSpecials });
    renderSpecials();
  } catch (err) {
    console.warn('Specials load failed:', err);
    renderSpecialsEmpty();
  }
}

function renderSpecials() {
  const grid = document.getElementById('specialsGrid');
  if (!grid) return;

  if (!allSpecials.length) { renderSpecialsEmpty(); return; }

  const mixed = mixSpecialsByCategory(allSpecials);

  const hasMore = mixed.length > MAX_VISIBLE_ON_HOMEPAGE;
  const visible = mixed.slice(0, MAX_VISIBLE_ON_HOMEPAGE);

  grid.innerHTML = visible.map(s => {
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

  grid.querySelectorAll('.special-card').forEach(card => {
    card.addEventListener('click', () => {
      const special = allSpecials.find(s => s.id === card.dataset.id);
      if (special) {
        // The special already has otherSpecials baked into it!
        openProductModal(special);
      }
    });
  });

  grid.querySelectorAll('.special-card-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const special = allSpecials.find(s => s.id === btn.dataset.specialId);
      if (special) {
        openProductModal(special);
      }
    });
  });

  if (hasMore) {
    const seeMore = document.createElement('button');
    seeMore.type = 'button';
    seeMore.className = 'special-card see-more-tile';
    seeMore.setAttribute('aria-label', 'See all specials');
    seeMore.innerHTML = `
      <span class="see-more-icon"><i class="fas fa-arrow-right" aria-hidden="true"></i></span>
      <span class="see-more-label">See More</span>
      <span class="see-more-sub">View all ${mixed.length} specials</span>
    `;
    seeMore.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openSpecialsCarousel();
    });
    grid.appendChild(seeMore);
  }
}

function renderSpecialsEmpty() {
  const grid = document.getElementById('specialsGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="specials-empty">
      <i class="fas fa-tag" aria-hidden="true"></i>
      <p style="margin:8px 0 0;">No specials running right now. Check back soon.</p>
    </div>
  `;
}

// ============================================================
//  5. CATEGORIES
// ============================================================
function renderCategories() {
  const grid = document.getElementById('categoriesGrid');
  if (!grid) return;

  grid.innerHTML = CATEGORIES.map(c => `
    <button class="cat-chip" type="button" data-cat="${c.id}" role="listitem" aria-label="${escapeHtml(c.label)}">
      <span class="cat-chip-icon"><i class="fas ${c.icon}" aria-hidden="true"></i></span>
      <span class="cat-chip-label">${escapeHtml(c.label)}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat || 'all';

      if (currentStoreFilter === cat && cat !== 'all') {
        currentStoreFilter = 'all';
      } else {
        currentStoreFilter = cat;
      }

      syncStoreFilterTabs();
      syncCategoryChips();
      renderStores();

      const storesSection = document.getElementById('stores');
      if (storesSection) storesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function syncStoreFilterTabs() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    const isActive = (tab.dataset.filter || 'all') === currentStoreFilter;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function syncCategoryChips() {
  const chips = document.querySelectorAll('.cat-chip');
  chips.forEach(chip => {
    const isActive = (chip.dataset.cat || 'all') === currentStoreFilter;
    chip.classList.toggle('active', isActive);
  });
}

// ============================================================
//  6. STORES
// ============================================================
async function loadStores() {
  const grid = document.getElementById('storesGrid');
  if (!grid) return;

  console.log('🏬 Loading stores...');
  try {
    const q = query(collection(db, 'stores'), orderBy('name'));
    const snap = await getDocs(q);
    allStores = [];
    snap.forEach(d => {
      const data = d.data();
      allStores.push({ id: d.id, ...data });
    });
    console.log('🏬 Loaded', allStores.length, 'stores');
    setProductModalData({ stores: allStores, products: allProducts });
    renderStores();
    initStoreFilters();
  } catch (err) {
    console.error('❌ Stores load failed:', err);
    grid.innerHTML = `<div class="stores-empty">Couldn't load stores right now. Please try again.</div>`;
  }
}

// Hours logic lives in ./hours-utils.js (shared with stores, store,
// and checkout pages). index.js just reads the result.

function renderStores() {
  const grid = document.getElementById('storesGrid');
  if (!grid) return;

  const filtered = allStores.filter(store => {
    const status = getStoreStatus(store);
    store._status = status;
    store._closed = status.state === 'closed';

    if (currentStoreFilter === 'all') return true;
    if (currentStoreFilter === 'open') {
      return status.state === 'open' || status.state === 'lunch';
    }

    const cats = [];
    if (Array.isArray(store.categories)) cats.push(...store.categories.map(c => String(c).toLowerCase()));
    if (Array.isArray(store.category)) cats.push(...store.category.map(c => String(c).toLowerCase()));
    else if (typeof store.category === 'string' && store.category) cats.push(store.category.toLowerCase());

    return cats.includes(currentStoreFilter);
  });

  if (!filtered.length) {
    // Even with no stores, we still want the request tile visible.
    grid.innerHTML = `
      <div class="stores-empty">
        <i class="fas fa-store" aria-hidden="true" style="font-size:1.6rem;color:var(--orange);display:block;margin-bottom:8px;"></i>
        <p style="margin:0 0 12px;">No stores available in this category yet.</p>
      </div>
    ` + buildStoreRequestTileHtml();
    wireStoreRequestTile(grid);
    return;
  }

  const hasMore = filtered.length > MAX_VISIBLE_ON_HOMEPAGE;
  const visible = filtered.slice(0, MAX_VISIBLE_ON_HOMEPAGE);

  const storeCardsHtml = visible.map(store => {
    const logo = store.logo || 'img/placeholder.jpg';
    const desc = store.description || '';

    const st = store._status?.state || 'closed';
    let badge;
    if (st === 'open') {
      badge = `<span class="store-card-badge open">Open</span>`;
    } else if (st === 'lunch') {
      badge = `<span class="store-card-badge lunch" style="background:#FEF3C7;color:#92400E;">Closed · back at ${escapeHtml(store._status.reopenAt || '')}</span>`;
    } else {
      badge = `<span class="store-card-badge closed">Closed</span>`;
    }

    const deliveryFrom = store.deliveryFee
      ? `<span>Delivery from R${Number(store.deliveryFee).toFixed(2)}</span>`
      : `<span>Delivery from R35</span>`;

    return `
        <a class="store-card" href="/store/${(store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}" role="listitem">
        <img class="store-card-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(store.name || '')} logo" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        <div class="store-card-body">
          <div class="store-card-name">${escapeHtml(store.name || '')}</div>
          ${desc ? `<div class="store-card-desc">${escapeHtml(desc)}</div>` : ''}
          <div class="store-card-meta">
            ${badge}
            ${deliveryFrom}
          </div>
        </div>
      </a>
    `;
  }).join('');

  grid.innerHTML = storeCardsHtml;

  if (hasMore) {
    const seeMore = document.createElement('button');
    seeMore.type = 'button';
    seeMore.className = 'store-card see-more-tile';
    seeMore.setAttribute('aria-label', 'See all stores');
    seeMore.innerHTML = `
      <span class="see-more-icon"><i class="fas fa-arrow-right" aria-hidden="true"></i></span>
      <span class="see-more-label">See More</span>
      <span class="see-more-sub">View all ${filtered.length} stores</span>
    `;
    seeMore.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openStoresCarousel();
    });
    grid.appendChild(seeMore);
  }

  // Always append the "Can't find your store?" tile at the end.
  const requestWrapper = document.createElement('div');
  requestWrapper.innerHTML = buildStoreRequestTileHtml();
  const requestTile = requestWrapper.firstElementChild;
  grid.appendChild(requestTile);

  wireStoreRequestTile(grid);
}

function initStoreFilters() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      currentStoreFilter = tab.dataset.filter || 'all';
      syncStoreFilterTabs();
      syncCategoryChips();
      renderStores();
    });
  });
}

// ============================================================
//  6b. SEE MORE — Carousel
// ============================================================
function openSpecialsCarousel() {
  const mixed = mixSpecialsByCategory(allSpecials);

  const items = mixed.map((s) => ({
    id: s.id,
    title: s.item || '',
    subtitle: s.store || '', // Store name
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

function openStoresCarousel() {
  const items = allStores.map((s) => ({
    id: s.id,
    title: s.name || '',
    subtitle: s.description || '',
    image: s.logo || 'img/placeholder.jpg',
    price: s.deliveryFee ? `Delivery from R${Number(s.deliveryFee).toFixed(2)}` : 'Delivery from R35',
    oldPrice: '',
    tag: s._closed ? 'Closed' : '',
    searchText: `${s.name || ''} ${s.description || ''} ${s.category || ''}`.toLowerCase(),
    kind: 'store',
    href: s.name ? `/store/${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}` : '',
    ctaLabel: 'Visit Store'
  }));

  openCarouselModal({
    title: 'All Stores',
    placeholder: 'Search stores by name or category...',
    items,
    emptyText: 'No stores match your search.',
    onItemTap: (item) => {
      if (item.href) {
        setTimeout(() => { window.location.href = item.href; }, 120);
      }
    }
  });
}

// ============================================================
//  7. FAQ
// ============================================================
function initFAQ() {
  const list = document.getElementById('faqList');
  if (!list) return;

  list.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      const item = btn.closest('.faq-item');
      const answer = item ? item.querySelector('.faq-a') : null;
      if (!item || !answer) return;

      list.querySelectorAll('.faq-q').forEach(otherBtn => {
        if (otherBtn !== btn && otherBtn.getAttribute('aria-expanded') === 'true') {
          const otherItem = otherBtn.closest('.faq-item');
          const otherAns = otherItem ? otherItem.querySelector('.faq-a') : null;
          if (otherItem && otherAns) {
            otherBtn.setAttribute('aria-expanded', 'false');
            otherItem.classList.remove('open');
            otherAns.style.maxHeight = '0px';
            setTimeout(() => { otherAns.hidden = true; }, 350);
          }
        }
      });

      if (isOpen) {
        btn.setAttribute('aria-expanded', 'false');
        item.classList.remove('open');
        answer.style.maxHeight = '0px';
        setTimeout(() => { answer.hidden = true; }, 350);
      } else {
        btn.setAttribute('aria-expanded', 'true');
        item.classList.add('open');
        answer.hidden = false;
        answer.style.maxHeight = answer.scrollHeight + 'px';
        setTimeout(() => {
          if (btn.getAttribute('aria-expanded') === 'true') answer.style.maxHeight = 'none';
        }, 400);
      }
    });
  });
}

// ============================================================
//  8. INSTALL SHEET
// ============================================================
let deferredInstallPrompt = null;
let installSheetShownThisSession = false;

function initInstallSheet() {
  const sheet = document.getElementById('installSheet');
  const closeBtn = document.getElementById('installSheetClose');
  const laterBtn = document.getElementById('installSheetLater');
  const installBtn = document.getElementById('installSheetInstall');
  const iosHint = document.getElementById('installSheetIosHint');
  const backdrop = document.getElementById('installSheetBackdrop');

  if (!sheet) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;
  if (isStandalone) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const openSheet = () => {
    if (installSheetShownThisSession) return;
    installSheetShownThisSession = true;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    document.body.style.overflow = 'hidden';

    if (isIOS && iosHint) {
      iosHint.hidden = false;
      if (installBtn) installBtn.style.display = 'none';
    }
  };

  const closeSheet = () => {
    sheet.classList.remove('open');
    setTimeout(() => {
      sheet.hidden = true;
      document.body.style.overflow = '';
    }, 350);
  };

  const waitForConsent = () => {
    if (localStorage.getItem('cookieConsent')) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (localStorage.getItem('cookieConsent')) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  };

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showToast('Use your browser menu to add Ghost Shopper to your home screen.');
        return;
      }
      deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('Ghost Shopper installed! 🎉');
          closeSheet();
        }
      } catch (_) {}
      deferredInstallPrompt = null;
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
  if (laterBtn) laterBtn.addEventListener('click', closeSheet);
  if (backdrop) backdrop.addEventListener('click', closeSheet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!installSheetShownThisSession) {
      waitForConsent().then(() => {
        setTimeout(openSheet, 800);
      });
    }
  });

  if (isIOS && !installSheetShownThisSession) {
    waitForConsent().then(() => {
      setTimeout(openSheet, 1500);
    });
  }

  window.addEventListener('appinstalled', () => {
    closeSheet();
    deferredInstallPrompt = null;
  });
}

// ============================================================
//  9. ANNOUNCEMENT SHEET
// ============================================================
const ANNOUNCEMENT_SEEN_PREFIX = 'gs_announcement_seen_';

async function initAnnouncementSheet() {
  const sheet = document.getElementById('announcementSheet');
  if (!sheet) return;

  let latest = null;
  try {
    const now = new Date();
    const q = query(
      collection(db, 'announcements'),
      where('active', '==', true),
      orderBy('startDate', 'desc'),
      limit(5)
    );
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (latest) return;
      const start = data.startDate?.toDate ? data.startDate.toDate() : (data.startDate ? new Date(data.startDate) : null);
      const end   = data.endDate?.toDate   ? data.endDate.toDate()   : (data.endDate   ? new Date(data.endDate)   : null);
      if (start && start > now) return;
      if (end && end < now) return;
      latest = { id: d.id, ...data };
    });
  } catch (err) {
    console.warn('Announcements load failed:', err);
    return;
  }

  if (!latest) return;

  const seenKey = ANNOUNCEMENT_SEEN_PREFIX + latest.id;
  if (localStorage.getItem(seenKey) === '1') return;

  const closeBtn   = document.getElementById('announcementClose');
  const backdrop   = document.getElementById('announcementBackdrop');
  const titleEl    = document.getElementById('announcementTitle');
  const messageEl  = document.getElementById('announcementMessage');
  const mediaWrap  = document.getElementById('announcementMedia');
  const imageEl    = document.getElementById('announcementImage');
  const logoWrap   = document.getElementById('announcementStoreLogoWrap');
  const logoEl     = document.getElementById('announcementStoreLogo');
  const storeLink  = document.getElementById('announcementStoreLink');
  const fbLink     = document.getElementById('announcementFacebookLink');

  if (titleEl && latest.title)     titleEl.textContent = latest.title;
  if (messageEl && latest.message) messageEl.textContent = latest.message;
  if (latest.image && mediaWrap && imageEl) { imageEl.src = latest.image; mediaWrap.hidden = false; }
  if (latest.storeLogo && logoWrap && logoEl) { logoEl.src = latest.storeLogo; logoWrap.hidden = false; }
  if (latest.storeLink && storeLink) { storeLink.href = latest.storeLink; storeLink.hidden = false; }
  if (latest.facebookLink && fbLink) { fbLink.href = latest.facebookLink; fbLink.hidden = false; }

  const openSheet = () => {
    const installSheet = document.getElementById('installSheet');
    if (installSheet && installSheet.classList.contains('open')) {
      setTimeout(openSheet, 1500);
      return;
    }
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    document.body.style.overflow = 'hidden';
  };

  const closeSheet = () => {
    sheet.classList.remove('open');
    setTimeout(() => {
      sheet.hidden = true;
      document.body.style.overflow = '';
    }, 350);
    localStorage.setItem(seenKey, '1');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
  if (backdrop) backdrop.addEventListener('click', closeSheet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
  });

  const waitForConsent = () => {
    if (localStorage.getItem('cookieConsent')) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (localStorage.getItem('cookieConsent')) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  };

  waitForConsent().then(() => {
    setTimeout(openSheet, 2500);
  });
}

// ============================================================
//  9b. NEWSLETTER SUBSCRIBE (Frontend UI only for now)
// ============================================================
function initNewsletter() {
  const form = document.getElementById('newsletterForm');
  const input = document.getElementById('newsletterEmail');
  const btn = document.getElementById('newsletterSubmitBtn');
  const statusEl = document.getElementById('newsletterStatus');

  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = input.value.trim();

    if (!email || !email.includes('@')) {
      showStatus('Please enter a valid email.', 'error');
      return;
    }

    // Disable button and show loading
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    showStatus('', '');

    // TODO: Plug in the Cloud Function here
    // For now, we simulate a successful save so you can see the UI
    setTimeout(() => {
      showStatus('Thank you for subscribing! 🎉', 'success');
      input.value = '';
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-arrow-right"></i>';
    }, 1000);
  });

  function showStatus(msg, type) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'newsletter-status ' + (type || '');
  }
}

// ============================================================
//  10. BACK TO TOP
// ============================================================
function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  const toggle = () => {
    if (window.scrollY > 600) btn.classList.add('show');
    else btn.classList.remove('show');
  };
  window.addEventListener('scroll', toggle, { passive: true });
  toggle();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ============================================================
//  11. PARTNER WITH US MODAL
// ============================================================
function initPartnerModal() {
  const link = document.getElementById('partnerWithUsLink');
  const modal = document.getElementById('partnerModal');
  const backdrop = document.getElementById('partnerModalBackdrop');
  const closeBtn = document.getElementById('partnerModalClose');
  const emailBtn = document.getElementById('partnerEmailBtn');
  const waBtn = document.getElementById('partnerWhatsappBtn');

  if (!link || !modal) return;

  const messageTemplate = [
    'Hi Ghost Shopper,',
    '',
    "I'm interested in partnering with you. Here are my details:",
    '',
    'Name:',
    'Company:',
    'Contact number:',
    'Email:',
    'Store type / category:',
    'Area / location:',
    '',
    'Please send me more information about how to list my store on Ghost Shopper.',
    '',
    'Thanks.'
  ].join('\n');

  const PARTNER_EMAIL = 'wedeliverzn@gmail.com';
  const PARTNER_WHATSAPP = '27628989813';

  if (emailBtn) {
    const subject = encodeURIComponent('Partner enquiry — Ghost Shopper');
    const body = encodeURIComponent(messageTemplate);
    emailBtn.href = `mailto:${PARTNER_EMAIL}?subject=${subject}&body=${body}`;
  }

  if (waBtn) {
    const encoded = encodeURIComponent(messageTemplate);
    waBtn.href = `https://wa.me/${PARTNER_WHATSAPP}?text=${encoded}`;
  }

  const openModal = () => {
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    modal.classList.remove('open');
    setTimeout(() => {
      modal.hidden = true;
      document.body.style.overflow = '';
    }, 250);
  };

  link.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  if (emailBtn) emailBtn.addEventListener('click', () => setTimeout(closeModal, 200));
  if (waBtn) waBtn.addEventListener('click', () => setTimeout(closeModal, 200));
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

window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled promise rejection on homepage:', e.reason);
});