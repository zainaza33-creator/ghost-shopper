// ============================================================
//  cart.js — Ghost Shopper Cart page
//  Reads cart from localStorage, computes totals including
//  packaging fee, offers alternates and search-to-add.
//
//  PRICES ARE RECOMPUTED ON EVERY RENDER using getActivePrice()
//  so an expired special auto-reverts without any user action.
//
//  STOCK SAFETY: When the catalog loads, any item with stock === false
//  is automatically removed from the cart.
// ============================================================

console.log('🚀 cart.js booting...');

import { auth, db } from './firebase-config.js';
import {
  doc,
  getDocs,
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  initGlobal,
  showToast,
  updateCartBadge,
  getCart,
  saveCart,
  clearCart,
  openAuthModal
} from './global.js';

import { getActivePrice } from './cart-utils.js';
import { getCatalog } from './catalog-cache.js';

let trackPageView = () => {};
let trackCheckoutStarted = () => {};
let trackCartAbandoned = () => {};

import('./analytics.js')
  .then((analyticsModule) => {
    if (!analyticsModule) return;
    if (typeof analyticsModule.trackPageView === 'function') trackPageView = analyticsModule.trackPageView;
    if (typeof analyticsModule.trackCheckoutStarted === 'function') trackCheckoutStarted = analyticsModule.trackCheckoutStarted;
    if (typeof analyticsModule.trackCartAbandoned === 'function') trackCartAbandoned = analyticsModule.trackCartAbandoned;
  })
  .catch((err) => {
    console.warn('analytics.js unavailable (non-fatal):', err?.message || err);
  });

const PACKAGING_PRICE = 2.00;
const ITEMS_PER_PACKAGING = 4;

const loadingScreen       = document.getElementById('loadingScreen');
const cartContent         = document.getElementById('cartContent');
const cartStoreBadge      = document.getElementById('cartStoreBadge');
const cartStoreName       = document.getElementById('cartStoreName');
const cartHeaderCount     = document.getElementById('cartHeaderCount');

const cartSearchSection   = document.getElementById('cartSearchSection');
const cartSearchWrapper   = document.getElementById('cartSearchWrapper');
const cartSearchInput     = document.getElementById('cartSearchInput');
const cartSearchClear     = document.getElementById('cartSearchClear');
const cartSearchResults   = document.getElementById('cartSearchResults');

const altModal            = document.getElementById('altModal');
const altModalSub         = document.getElementById('altModalSub');
const altModalCurrent     = document.getElementById('altModalCurrent');
const altModalGrid        = document.getElementById('altModalGrid');
const altModalEmpty       = document.getElementById('altModalEmpty');
const altSkipBtn          = document.getElementById('altSkipBtn');
const altConfirmBtn       = document.getElementById('altConfirmBtn');

let deliveryFee = 35;
let allStores = [];
let allProducts = [];
let currentStoreName = null;
let currentStoreId = null;

let altEditingIndex = null;
let altSelectedId = null;

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
  try { trackPageView(); } catch (_) {}

  loadDeliveryFee();
  renderCart();
  initSearch();
  loadCatalog();
  initAltModalListeners();
  initBeforeUnload();
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
}

function loadDeliveryFee() {
  const settingsRef = doc(db, 'settings', 'delivery');
  onSnapshot(settingsRef, (docSnap) => {
    if (docSnap.exists()) {
      deliveryFee = docSnap.data().fee || 35;
      renderCart();
    }
  }, (err) => console.warn('Error loading delivery fee:', err));
}

let catalogReady = false;
let catalogLoading = false;
let catalogError = false;

async function loadCatalog() {
  if (catalogLoading) return;
  catalogLoading = true;
  catalogError = false;

  try {
    // Use our new cache module
    const { stores, products } = await getCatalog();
    
    allStores = stores;
    allProducts = products;
    catalogReady = true;

    // ---- STOCK SAFETY SWEEP ----
    sanitizeCart();
    // ----------------------------

    renderCart();

    if (cartSearchResults?.classList.contains('active') && cartSearchInput?.value.trim().length >= 2) {
      renderSearchResults(cartSearchInput.value.trim());
    }
    if (altModal && !altModal.hidden && altEditingIndex !== null) {
      const cart = getCart();
      const item = cart[altEditingIndex];
      if (item) renderAltModalGrid(item.category, item.id);
    }
  } catch (err) {
    console.warn('Could not load catalog:', err);
    allStores = [];
    allProducts = [];
    catalogError = true;
  } finally {
    catalogLoading = false;
  }
}

// Remove any cart line whose live product is out of stock.
function sanitizeCart() {
  const cart = getCart();
  if (!cart.length) return;

  let changed = false;
  const removedNames = [];

  for (let i = cart.length - 1; i >= 0; i--) {
    const item = cart[i];
    const live = findLiveProduct(item);
    if (live && live.stock === false) {
      removedNames.push(item.name || 'Item');
      cart.splice(i, 1);
      changed = true;
    }
  }

  if (changed) {
    saveCart(cart);
    if (removedNames.length === 1) {
      showToast(`"${removedNames[0]}" is out of stock and was removed from your cart.`);
    } else {
      showToast(`${removedNames.length} items are out of stock and were removed from your cart.`);
    }
  }
}

function getStoreByName(name) {
  if (!name) return null;
  return allStores.find(s => s.name === name) || null;
}

function getProductsInSameStore(storeName) {
  const store = getStoreByName(storeName);
  if (!store) return [];
  return allProducts.filter(p => p.storeId === store.id && p.stock !== false);
}

function findLiveProduct(cartItem) {
  if (!cartItem || !catalogReady) return null;
  if (cartItem.productId) {
    const byPid = allProducts.find(p => p.id === cartItem.productId);
    if (byPid) return byPid;
  }
  return allProducts.find(p => p.id === cartItem.id) || null;
}

function resolveItemPrice(cartItem) {
  const live = findLiveProduct(cartItem);
  if (live) return getActivePrice(live);
  return Number(cartItem.price) || 0;
}

function resolveBasePrice(cartItem) {
  const live = findLiveProduct(cartItem);
  if (live) return Number(live.price) || 0;
  return Number(cartItem.basePrice ?? cartItem.price) || 0;
}

function refreshCartPrices(cart) {
  if (!catalogReady) return cart;
  let changed = false;

  for (const item of cart) {
    const live = findLiveProduct(item);
    if (!live) continue;
    const active = getActivePrice(live);
    if (Number(item.price) !== active) {
      item.price = active;
      changed = true;
    }
    const base = Number(live.price) || 0;
    if (Number(item.basePrice) !== base) {
      item.basePrice = base;
      changed = true;
    }
    if (live.id && !item.productId) {
      item.productId = live.id;
      changed = true;
    }
  }
  if (changed) saveCart(cart);
  return cart;
}

function computeTotals(cart) {
  const itemCount = cart.reduce((sum, i) => sum + (i.quantity || 0), 0);
  const subtotal = cart.reduce((sum, i) => {
    const livePrice = resolveItemPrice(i);
    return sum + (livePrice * (i.quantity || 0));
  }, 0);

  const packagingCount = itemCount > 0
    ? Math.ceil(itemCount / ITEMS_PER_PACKAGING)
    : 0;
  const packagingFee = packagingCount * PACKAGING_PRICE;

  const delivery = subtotal > 0 ? deliveryFee : 0;
  const total = subtotal + packagingFee + delivery;

  return { itemCount, subtotal, packagingCount, packagingFee, delivery, total };
}

function renderCart() {
  let cart = getCart();
  cart = refreshCartPrices(cart);

  if (cart.length === 0) {
    currentStoreName = null;
    currentStoreId = null;
    if (cartStoreBadge) cartStoreBadge.hidden = true;
    if (cartHeaderCount) cartHeaderCount.textContent = '';
    if (cartSearchSection) cartSearchSection.hidden = true;
    renderEmptyState();
    return;
  }

  currentStoreName = cart[0].store || '';
  const store = getStoreByName(currentStoreName);
  currentStoreId = store ? store.id : (cart[0].storeId || null);

  if (cartStoreBadge && cartStoreName) {
    cartStoreName.textContent = currentStoreName || 'Store';
    cartStoreBadge.hidden = false;
  }

  const totals = computeTotals(cart);
  if (cartHeaderCount) {
    cartHeaderCount.textContent = `${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'}`;
  }

  if (cartSearchSection) cartSearchSection.hidden = false;

  renderItemsAndSummary(cart, totals);
}

function renderEmptyState() {
  if (!cartContent) return;
  cartContent.innerHTML = `
    <div class="cart-empty">
      <div class="cart-empty-icon">
        <i class="fas fa-shopping-bag" aria-hidden="true"></i>
      </div>
      <h2>Your cart is empty</h2>
      <p>Browse stores and add items you love.</p>
      <a href="stores.html" class="btn-primary">
        <i class="fas fa-store" aria-hidden="true"></i>
        <span>Browse Stores</span>
      </a>
    </div>
  `;
}

function renderItemsAndSummary(cart, totals) {
  if (!cartContent) return;

  const itemsHtml = cart.map((item, index) => renderCartItem(item, index)).join('');

  const packagingLabel = `Packaging × ${totals.packagingCount}`;
  const deliveryLabel = `Delivery Fee (from R${Number(deliveryFee).toFixed(2)})`;

  cartContent.innerHTML = `
    <div class="cart-items">${itemsHtml}</div>

    <div class="cart-summary">
      <div class="cart-summary-row">
        <span class="cart-summary-label">Subtotal</span>
        <span class="cart-summary-amount">R${totals.subtotal.toFixed(2)}</span>
      </div>
      <div class="cart-summary-row">
        <span class="cart-summary-label">${packagingLabel}</span>
        <span class="cart-summary-amount">R${totals.packagingFee.toFixed(2)}</span>
      </div>
      <div class="cart-summary-row">
        <span class="cart-summary-label">${deliveryLabel}</span>
        <span class="cart-summary-amount">R${totals.delivery.toFixed(2)}</span>
      </div>
      <div class="cart-summary-row cart-summary-total">
        <span class="cart-summary-label">Total (estimate)</span>
        <span class="cart-summary-amount">R${totals.total.toFixed(2)}</span>
      </div>

      <div class="cart-summary-actions">
        <button class="cart-empty-btn" id="emptyCartBtn" type="button">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
          <span>Empty Cart</span>
        </button>

        <button class="cart-checkout-btn" id="checkoutBtn" type="button">
          <i class="fas fa-lock" aria-hidden="true"></i>
          <span>Checkout</span>
        </button>
      </div>

      <div class="cart-summary-note">
        <i class="fas fa-map-pin" aria-hidden="true"></i>
        <span>Final delivery fee calculated at checkout based on your address.</span>
      </div>
    </div>
  `;

  wireItemEvents();
  wireSummaryEvents();
}

function renderCartItem(item, index) {
  const unitPrice = resolveItemPrice(item);
  const basePrice = resolveBasePrice(item);
  const lineTotal = unitPrice * (Number(item.quantity) || 0);
  const isOnActiveSpecial = item.onSpecial === true
    || (basePrice > 0 && unitPrice < basePrice);

  const hasAlt = item.alternate && item.alternate.id;

  const priceRow = isOnActiveSpecial
    ? `
      <span class="cart-item-price">R${lineTotal.toFixed(2)}</span>
      <span class="cart-item-unit-price">(${item.quantity} × <s>R${basePrice.toFixed(2)}</s> R${unitPrice.toFixed(2)})</span>
    `
    : `
      <span class="cart-item-price">R${lineTotal.toFixed(2)}</span>
      <span class="cart-item-unit-price">(${item.quantity} × R${unitPrice.toFixed(2)})</span>
    `;

  const specialTag = isOnActiveSpecial
    ? `<div class="cart-item-special"><i class="fas fa-bolt" aria-hidden="true"></i> Special price applied</div>`
    : '';

  return `
    <div class="cart-item" data-index="${index}">
      <div class="cart-item-img-wrap">
        <img class="cart-item-img" src="${escapeHtml(item.image || 'img/placeholder.jpg')}" alt="${escapeHtml(item.name || '')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name || '')}</div>
        ${item.weight ? `<div class="cart-item-weight">${escapeHtml(item.weight)}</div>` : ''}
        <div class="cart-item-price-row">${priceRow}</div>
        ${specialTag}
        ${hasAlt ? `
          <div class="cart-item-alternate">
            <i class="fas fa-exchange-alt" aria-hidden="true"></i>
            <span>Alternate: <strong>${escapeHtml(item.alternate.name || '')}</strong></span>
          </div>
        ` : ''}
      </div>
      <div class="cart-item-actions">
        <div class="cart-item-qty">
          <button type="button" class="cart-qty-btn" data-action="dec" data-index="${index}" aria-label="Decrease quantity">
            <i class="fas fa-minus" aria-hidden="true"></i>
          </button>
          <span class="cart-qty-value">${item.quantity}</span>
          <button type="button" class="cart-qty-btn" data-action="inc" data-index="${index}" aria-label="Increase quantity">
            <i class="fas fa-plus" aria-hidden="true"></i>
          </button>
        </div>
        <button type="button" class="cart-item-alt-btn ${hasAlt ? 'has-alt' : ''}" data-index="${index}">
          <i class="fas fa-exchange-alt" aria-hidden="true"></i>
          <span>${hasAlt ? 'Change Alt' : 'Add Alt'}</span>
        </button>
        <button type="button" class="cart-item-remove" data-index="${index}" aria-label="Remove item">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function wireItemEvents() {
  if (!cartContent) return;

  cartContent.querySelectorAll('.cart-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      const action = btn.dataset.action;
      const cart = getCart();
      if (!cart[index]) return;

      if (action === 'inc') {
        cart[index].quantity = (cart[index].quantity || 1) + 1;
      } else if (action === 'dec') {
        if ((cart[index].quantity || 1) > 1) {
          cart[index].quantity = cart[index].quantity - 1;
        } else {
          cart.splice(index, 1);
        }
      }
      saveCart(cart);
      renderCart();
    });
  });

  cartContent.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      const cart = getCart();
      const removed = cart[index];
      if (!removed) return;
      cart.splice(index, 1);
      saveCart(cart);
      renderCart();
      showToast(`${removed.name || 'Item'} removed from cart.`);
    });
  });

  cartContent.querySelectorAll('.cart-item-alt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      openAltModal(index);
    });
  });
}

function wireSummaryEvents() {
  const emptyBtn = document.getElementById('emptyCartBtn');
  if (emptyBtn) {
    emptyBtn.addEventListener('click', () => {
      if (!confirm('Are you sure you want to empty your entire cart?')) return;
      clearCart();
      renderCart();
      showToast('Cart emptied.');
    });
  }

  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      const cart = getCart();
      if (cart.length === 0) {
        showToast('Your cart is empty!');
        return;
      }
      try { trackCheckoutStarted(); } catch (_) {}

      if (auth.currentUser) {
        window.location.href = 'checkout.html';
      } else {
        openAuthModal(() => {
          window.location.href = 'checkout.html';
        });
      }
    });
  }
}

function initSearch() {
  if (!cartSearchInput || !cartSearchResults || !cartSearchClear) return;

  let debounce = null;

  cartSearchInput.addEventListener('input', () => {
    const q = cartSearchInput.value.trim();
    cartSearchClear.hidden = q.length === 0;

    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (q.length < 2) {
        cartSearchResults.classList.remove('active');
        cartSearchResults.innerHTML = '';
        return;
      }
      renderSearchResults(q);
    }, 180);
  });

  cartSearchClear.addEventListener('click', () => {
    cartSearchInput.value = '';
    cartSearchClear.hidden = true;
    cartSearchResults.classList.remove('active');
    cartSearchResults.innerHTML = '';
    cartSearchInput.focus();
  });

  document.addEventListener('click', (e) => {
    if (cartSearchWrapper && !cartSearchWrapper.contains(e.target) && !cartSearchResults.contains(e.target)) {
      cartSearchResults.classList.remove('active');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cartSearchResults.classList.remove('active');
      if (document.activeElement === cartSearchInput) cartSearchInput.blur();
    }
  });
}

function renderSearchResults(q) {
  if (!currentStoreName) {
    cartSearchResults.innerHTML = `<div class="cart-search-empty">Add items to your cart first to search in a store.</div>`;
    cartSearchResults.classList.add('active');
    return;
  }

  if (!catalogReady) {
    cartSearchResults.innerHTML = `
      <div class="cart-search-empty">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span style="margin-left:6px;">Loading items…</span>
      </div>
    `;
    cartSearchResults.classList.add('active');
    return;
  }

  if (catalogError) {
    cartSearchResults.innerHTML = `<div class="cart-search-empty">Could not load items. Please refresh.</div>`;
    cartSearchResults.classList.add('active');
    return;
  }

  const term = q.toLowerCase();
  const storeProducts = getProductsInSameStore(currentStoreName);

  const matches = storeProducts
    .filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.desc || '').toLowerCase().includes(term) ||
      (p.category || '').toLowerCase().includes(term)
    )
    .slice(0, 20);

  if (!matches.length) {
    cartSearchResults.innerHTML = `<div class="cart-search-empty">No items match "${escapeHtml(q)}" in this store.</div>`;
    cartSearchResults.classList.add('active');
    return;
  }

  cartSearchResults.innerHTML = matches.map(p => {
    const activePrice = getActivePrice(p);
    const isSpecial = activePrice !== Number(p.price);
    const priceHtml = isSpecial
      ? `<span class="cart-search-result-price">R${activePrice.toFixed(2)}</span> <s style="color:var(--text-muted);font-size:0.72rem;">R${Number(p.price).toFixed(2)}</s>`
      : `<span class="cart-search-result-price">R${Number(p.price || 0).toFixed(2)}</span>`;

    return `
      <div class="cart-search-result" data-id="${p.id}">
        <img src="${escapeHtml(p.image || 'img/placeholder.jpg')}" alt="${escapeHtml(p.name || '')}" loading="lazy" onerror="this.src='img/placeholder.jpg'" />
        <div class="cart-search-result-info">
          <div class="cart-search-result-name">${escapeHtml(p.name || '')}</div>
          <div>${priceHtml}</div>
        </div>
        <button type="button" class="cart-search-result-btn add" data-action="add" data-id="${p.id}" aria-label="Add to cart">
          <i class="fas fa-plus" aria-hidden="true"></i>
        </button>
        <button type="button" class="cart-search-result-btn alt" data-action="alt" data-id="${p.id}" aria-label="Set as alternate">
          <i class="fas fa-exchange-alt" aria-hidden="true"></i>
        </button>
      </div>
    `;
  }).join('');
  cartSearchResults.classList.add('active');

  cartSearchResults.querySelectorAll('.cart-search-result-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const product = allProducts.find(p => p.id === id);
      if (!product) return;

      if (action === 'add') {
        addItemFromSearch(product);
      } else if (action === 'alt') {
        addAlternateFromSearch(product);
      }
    });
  });
}

function addItemFromSearch(product) {
  if (product.stock === false) {
    showToast(`${product.name} is out of stock.`);
    return;
  }

  const cart = getCart();
  if (!cart.length) return;

  const activePrice = getActivePrice(product);

  const existing = cart.find(i => i.id === product.id || i.productId === product.id);
  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
    existing.price = activePrice;
    existing.basePrice = Number(product.price) || 0;
    existing.productId = product.id;
  } else {
    cart.push({
      id: product.id,
      productId: product.id,
      name: product.name,
      store: currentStoreName,
      storeId: currentStoreId,
      price: activePrice,
      basePrice: Number(product.price) || 0,
      quantity: 1,
      image: product.image || 'img/placeholder.jpg',
      weight: product.weight || '',
      category: product.category || 'Uncategorized'
    });
  }
  saveCart(cart);
  renderCart();
  showToast(`${product.name} added to cart.`);

  cartSearchInput.value = '';
  cartSearchClear.hidden = true;
  cartSearchResults.classList.remove('active');
  cartSearchResults.innerHTML = '';
}

function addAlternateFromSearch(product) {
  const cart = getCart();
  let index = cart.findIndex(i => i.id === product.id || i.productId === product.id);

  if (index === -1) {
    const activePrice = getActivePrice(product);
    cart.push({
      id: product.id,
      productId: product.id,
      name: product.name,
      store: currentStoreName,
      storeId: currentStoreId,
      price: activePrice,
      basePrice: Number(product.price) || 0,
      quantity: 1,
      image: product.image || 'img/placeholder.jpg',
      weight: product.weight || '',
      category: product.category || 'Uncategorized'
    });
    index = cart.length - 1;
  }

  altEditingIndex = index;
  altSelectedId = null;

  const target = cart[index];
  if (altModalSub) {
    altModalSub.textContent = `If ${target.name} is unavailable, we'll substitute with:`;
  }

  renderAltModalGrid(target.category, target.id);

  if (altModal) {
    altModal.hidden = false;
    requestAnimationFrame(() => altModal.classList.add('open'));
    document.body.style.overflow = 'hidden';
  }

  const card = altModalGrid?.querySelector(`.alt-modal-item[data-id="${product.id}"]`);
  if (card) {
    card.classList.add('selected');
    altSelectedId = product.id;
    if (altConfirmBtn) altConfirmBtn.disabled = false;
  }

  if (altModalCurrent) altModalCurrent.hidden = true;
}

function openAltModal(index) {
  const cart = getCart();
  const item = cart[index];
  if (!item) return;

  altEditingIndex = index;
  altSelectedId = null;

  const category = item.category || '';

  if (!catalogReady) {
    if (altModalSub) altModalSub.textContent = `If ${item.name} is unavailable, we'll substitute with:`;
    if (altModalCurrent) altModalCurrent.hidden = true;
    if (altModalGrid) {
      altModalGrid.innerHTML = `
        <div style="grid-column:1 / -1; text-align:center; padding:2rem 1rem; color:var(--text-secondary);">
          <i class="fas fa-spinner fa-spin" style="font-size:1.4rem; color:var(--orange);"></i>
          <p style="margin:8px 0 0; font-size:0.85rem;">Loading alternates…</p>
        </div>
      `;
    }
    if (altModalEmpty) altModalEmpty.hidden = true;
    if (altModal) {
      altModal.hidden = false;
      requestAnimationFrame(() => altModal.classList.add('open'));
      document.body.style.overflow = 'hidden';
    }
    if (altConfirmBtn) altConfirmBtn.disabled = true;
    return;
  }

  if (altModalSub) {
    altModalSub.textContent = `If ${item.name} is unavailable, we'll substitute with:`;
  }

  if (altModalCurrent) {
    if (item.alternate && item.alternate.id) {
      altModalCurrent.hidden = false;
      altModalCurrent.innerHTML = `
        <div class="alt-modal-current-label">Currently selected:</div>
        <div class="alt-modal-current-name">${escapeHtml(item.alternate.name || '')}</div>
        <div class="alt-modal-current-hint">Pick a different one below, or confirm to keep it.</div>
      `;
      altSelectedId = item.alternate.id;
    } else {
      altModalCurrent.hidden = true;
      altModalCurrent.innerHTML = '';
    }
  }

  renderAltModalGrid(category, item.id);

  if (altModal) {
    altModal.hidden = false;
    requestAnimationFrame(() => altModal.classList.add('open'));
    document.body.style.overflow = 'hidden';
  }

  if (altSelectedId && altModalGrid) {
    const card = altModalGrid.querySelector(`.alt-modal-item[data-id="${altSelectedId}"]`);
    if (card) card.classList.add('selected');
  }

  if (altConfirmBtn) altConfirmBtn.disabled = !altSelectedId;
}

function renderAltModalGrid(category, excludeId) {
  if (!altModalGrid || !altModalEmpty) return;

  if (!currentStoreName) {
    altModalGrid.innerHTML = '';
    altModalEmpty.hidden = false;
    return;
  }

  const storeProducts = getProductsInSameStore(currentStoreName);
  const matches = storeProducts.filter(p => p.id !== excludeId && (!category || p.category === category));

  if (!matches.length) {
    altModalGrid.innerHTML = '';
    altModalEmpty.hidden = false;
    return;
  }

  altModalEmpty.hidden = true;

  altModalGrid.innerHTML = matches.map(p => {
    const activePrice = getActivePrice(p);
    const isSpecial = activePrice !== Number(p.price);
    const priceHtml = isSpecial
      ? `R${activePrice.toFixed(2)} <s style="color:var(--text-muted);font-size:0.7rem;">R${Number(p.price).toFixed(2)}</s>`
      : `R${Number(p.price || 0).toFixed(2)}`;

    return `
      <button type="button" class="alt-modal-item" data-id="${p.id}">
        <div class="alt-modal-item-img-wrap">
          <img src="${escapeHtml(p.image || 'img/placeholder.jpg')}" alt="${escapeHtml(p.name || '')}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        </div>
        <div class="alt-modal-item-body">
          <div class="alt-modal-item-name">${escapeHtml(p.name || '')}</div>
          <div class="alt-modal-item-price">${priceHtml}</div>
        </div>
      </button>
    `;
  }).join('');

  altModalGrid.querySelectorAll('.alt-modal-item').forEach(card => {
    card.addEventListener('mouseenter', () => showAltTileTooltip(card));
    card.addEventListener('mouseleave', () => hideAltTileTooltip());
    card.addEventListener('focus', () => showAltTileTooltip(card));
    card.addEventListener('blur', () => hideAltTileTooltip());

    card.addEventListener('click', () => {
      altModalGrid.querySelectorAll('.alt-modal-item').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      altSelectedId = card.dataset.id;
      if (altConfirmBtn) altConfirmBtn.disabled = false;

      if (window.matchMedia('(hover: none), (pointer: coarse)').matches) {
        showAltTileTooltip(card);
      }
    });
  });
}

function initAltModalListeners() {
  if (!altModal) return;

  altModal.querySelectorAll('[data-alt-close]').forEach(el => {
    el.addEventListener('click', closeAltModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && altModal.classList.contains('open')) {
      closeAltModal();
    }
  });

  if (altSkipBtn) {
    altSkipBtn.addEventListener('click', () => {
      if (altEditingIndex !== null) {
        const cart = getCart();
        if (cart[altEditingIndex]) {
          delete cart[altEditingIndex].alternate;
          saveCart(cart);
          renderCart();
          showToast('Alternate removed.');
        }
      }
      closeAltModal();
    });
  }

  if (altConfirmBtn) {
    altConfirmBtn.addEventListener('click', () => {
      if (altEditingIndex === null || !altSelectedId) return;

      const alt = allProducts.find(p => p.id === altSelectedId);
      if (!alt) return;

      const cart = getCart();
      if (!cart[altEditingIndex]) return;

      cart[altEditingIndex].alternate = {
        id: alt.id,
        name: alt.name,
        price: getActivePrice(alt),
        image: alt.image || 'img/placeholder.jpg'
      };
      saveCart(cart);
      closeAltModal();
      renderCart();
      showToast(`Alternate set: ${alt.name}`);
    });
  }
}

function closeAltModal() {
  if (!altModal) return;
  altModal.classList.remove('open');
  setTimeout(() => {
    altModal.hidden = true;
    document.body.style.overflow = '';
  }, 250);
  altEditingIndex = null;
  altSelectedId = null;
  if (altConfirmBtn) altConfirmBtn.disabled = true;
}

function initBeforeUnload() {
  window.addEventListener('beforeunload', () => {
    const cart = getCart();
    if (cart.length > 0) {
      try {
        const subtotal = cart.reduce((s, i) => s + (resolveItemPrice(i) * i.quantity), 0);
        trackCartAbandoned(cart, subtotal, currentStoreId, currentStoreName || 'Unknown');
      } catch (_) {}
    }
  });
}

let _altTileTooltipEl = null;
let _altTileTooltipTimer = null;
const ALT_TILE_TOOLTIP_MS = 2200;

function showAltTileTooltip(tile) {
  clearTimeout(_altTileTooltipTimer);

  if (!_altTileTooltipEl) {
    _altTileTooltipEl = document.createElement('div');
    _altTileTooltipEl.className = 'alt-tile-tooltip';
    document.body.appendChild(_altTileTooltipEl);
  }

  const id = tile.dataset.id;
  const product = allProducts.find(p => p.id === id);
  const name = product ? (product.name || '') : '';
  const price = product ? getActivePrice(product).toFixed(2) : '';
  const weight = product && product.weight ? product.weight : '';

  _altTileTooltipEl.innerHTML = `
    <div class="alt-tile-tooltip-name">${escapeHtml(name)}</div>
    ${weight ? `<div class="alt-tile-tooltip-weight">${escapeHtml(weight)}</div>` : ''}
    <div class="alt-tile-tooltip-price">R${price}</div>
  `;

  const rect = tile.getBoundingClientRect();
  _altTileTooltipEl.style.visibility = 'hidden';
  _altTileTooltipEl.classList.add('show');
  const ttRect = _altTileTooltipEl.getBoundingClientRect();

  let top = rect.top - ttRect.height - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - ttRect.width / 2;
  const maxLeft = window.innerWidth - ttRect.width - 8;
  if (left < 8) left = 8;
  if (left > maxLeft) left = maxLeft;

  _altTileTooltipEl.style.top = `${top}px`;
  _altTileTooltipEl.style.left = `${left}px`;
  _altTileTooltipEl.style.visibility = '';

  _altTileTooltipTimer = setTimeout(hideAltTileTooltip, ALT_TILE_TOOLTIP_MS);
}

function hideAltTileTooltip() {
  clearTimeout(_altTileTooltipTimer);
  if (_altTileTooltipEl) {
    _altTileTooltipEl.classList.remove('show');
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}