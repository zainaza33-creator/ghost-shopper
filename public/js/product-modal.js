// ============================================================
//  product-modal.js — Shared product modal for Ghost Shopper
// ============================================================

import { db } from './firebase-config.js';
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  showToast,
  getCart,
  clearCart,
  updateCartBadge
} from './global.js';

import { addToCart, getActivePrice } from './cart-utils.js';

// ---- Module state ----
let _allStores = [];
let _allProducts = [];
let _modalState = {
  product: null,
  quantity: 1
};

let _altTooltipEl = null;
let _altTooltipTimer = null;
const TOOLTIP_HIDE_MS = 2000;

let _lightboxStylesInjected = false;

// ============================================================
//  PUBLIC API
// ============================================================
export function setProductModalData({ stores, products }) {
  if (Array.isArray(stores)) _allStores = stores;
  if (Array.isArray(products)) _allProducts = products;
}

export function getProductModalState() {
  return _modalState;
}

// ============================================================
//  LIGHTBOX STYLES
// ============================================================
function injectLightboxStyles() {
  if (_lightboxStylesInjected) return;
  _lightboxStylesInjected = true;

  const style = document.createElement('style');
  style.id = 'gsPmLightboxStyles';
  style.textContent = `
    .pm-lightbox {
      position: fixed;
      inset: 0;
      z-index: 5500;
      background: rgba(0, 0, 0, 0.94);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      transition: opacity 0.22s ease;
      cursor: zoom-out;
    }
    .pm-lightbox.open { opacity: 1; }
    .pm-lightbox-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 6px;
      user-select: none;
      -webkit-user-drag: none;
      pointer-events: none;
    }
    .pm-lightbox-close {
      position: absolute;
      top: calc(env(safe-area-inset-top, 0px) + 14px);
      right: 14px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      font-size: 1.05rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, transform 0.2s;
    }
    .pm-lightbox-close:hover {
      background: rgba(255, 255, 255, 0.28);
      transform: rotate(90deg);
    }
    .pm-hero { cursor: zoom-in; }
    .pm-hero::after {
      content: '\\f00e';
      font-family: 'Font Awesome 6 Free', 'Font Awesome 5 Free';
      font-weight: 900;
      position: absolute;
      bottom: 10px;
      right: 10px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.5);
      color: #fff;
      font-size: 0.78rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0.85;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
//  OPEN PRODUCT MODAL
// ============================================================
export function openProductModal(item) {
  if (!item) return;

  injectLightboxStyles();

  // Normalize
  const product = {
    id: item.id,
    productId: item.productId || null,
    name: item.item || item.name || 'Item',
    price: typeof item.price === 'number' ? item.price : 0,
    oldPrice: (typeof item.oldPrice === 'number' && item.oldPrice > 0) ? item.oldPrice : null,
    image: item.image || 'img/placeholder.jpg',
    store: item.store || item.storeName || '',
    storeId: item.storeId || null,
    category: item.category || '',
    tag: item.tag || 'Special',
    desc: item.desc || item.description || '',
    weight: item.weight || '', 
    isSpecial: !!item.item || item.isSpecial === true,
    stock: item.stock !== false,
    onSpecial: item.onSpecial === true,
    specialPrice: item.specialPrice,
    specialStartDate: item.specialStartDate,
    specialEndDate: item.specialEndDate,
    otherSpecials: item.otherSpecials || null // Pass this through
  };

  // Fill missing data from live product if available
  if (product.productId) {
    const live = _allProducts.find(p => p.id === product.productId);
    if (live) {
      if (live.onSpecial === true) {
        product.onSpecial = true;
        product.specialPrice = live.specialPrice;
        product.specialStartDate = live.specialStartDate;
        product.specialEndDate = live.specialEndDate;
      }
      if (!product.store) product.store = live.store || live.storeName || '';
      if (!product.storeId) product.storeId = live.storeId || null;
      if (!product.category) product.category = live.category || '';
      if (!product.image || product.image === 'img/placeholder.jpg') product.image = live.image || product.image;
      product.stock = live.stock !== false;
    }
  } else if (!product.onSpecial && product.id) {
    const live = _allProducts.find(p => p.id === product.id);
    if (live && live.onSpecial === true) {
      product.onSpecial = true;
      product.specialPrice = live.specialPrice;
      product.specialStartDate = live.specialStartDate;
      product.specialEndDate = live.specialEndDate;
      if (!product.store) product.store = live.store || '';
      if (!product.storeId) product.storeId = live.storeId || null;
      if (!product.category) product.category = live.category || '';
    }
    if (live) product.stock = live.stock !== false;
  }

  const effectivePrice = getActivePrice(product);
  const isOnActiveSpecial = effectivePrice !== product.price && product.onSpecial === true;
  const inStock = product.stock !== false;

  const existing = document.getElementById('gsProductModal');
  if (existing) existing.remove();

  _modalState = { product, quantity: 1 };

  // ============================================================
  //  DETERMINE ALTERNATIVES
  // ============================================================
  // We are checking if _allProducts has items. 
  // If it does, we are on the Stores/Store page and we can show the category rail.
  // If it doesn't, we are on the Homepage, and we hide the rail.
  let alternatives = [];
  let altTitle = 'More Options';
  const isStorePage = _allProducts.length > 0;

  if (isStorePage) {
    const storeProducts = _allProducts.filter(p => 
      p.storeId === product.storeId && p.stock !== false
    );
    
    if (product.category && product.category.trim()) {
      const catLower = product.category.toLowerCase().trim();
      alternatives = storeProducts.filter(p => 
        (p.category || '').toLowerCase().trim() === catLower && 
        p.id !== product.id
      );
      altTitle = `More ${product.category} Options`;
    } else {
      alternatives = storeProducts.filter(p => p.id !== product.id).slice(0, 8);
      altTitle = 'More Options';
    }
  }

  const priceHtml = !inStock
    ? `<span class="pm-price-now" style="color:var(--text-muted);font-size:1.1rem;font-weight:700;">Out of Stock</span>`
    : isOnActiveSpecial
      ? `<span class="pm-price-now">R${effectivePrice.toFixed(2)}</span>
         <span class="pm-price-old">R${product.price.toFixed(2)}</span>`
      : `<span class="pm-price-now">R${product.price.toFixed(2)}</span>
         ${product.oldPrice ? `<span class="pm-price-old">R${product.oldPrice.toFixed(2)}</span>` : ''}`;

  const altHtml = alternatives.length
    ? `
      <div class="pm-alts-section">
        <div class="pm-alts-title">
          <i class="fas ${product.otherSpecials ? 'fa-tags' : 'fa-layer-group'}" aria-hidden="true"></i>
          ${escapeHtmlAttr(altTitle)}
        </div>
        <div class="pm-alts-grid">
          ${alternatives.map(a => {
            const aPrice = getActivePrice(a);
            const aIsSpecial = isSpecialActive(a);
            const aBasePrice = Number(a.price) || 0;
            
            const aPriceHtml = aIsSpecial
              ? `<span>R${aPrice.toFixed(2)}</span> <span class="pm-alt-old">R${aBasePrice.toFixed(2)}</span>`
              : `<span>R${aPrice.toFixed(2)}</span>`;
            
            const displayName = a.item || a.name || 'Special Item';
            const displayDesc = a.desc || '';
            
            return `
              <button type="button" class="pm-alt-item" 
                data-alt-id="${a.id}"
                data-alt-name="${escapeHtmlAttr(displayName)}"
                data-alt-desc="${escapeHtmlAttr(displayDesc)}"
                data-alt-price="R${aPrice.toFixed(2)}"
                data-alt-json="${escapeHtmlAttr(JSON.stringify(a))}">
                <img src="${escapeHtmlAttr(a.image || 'img/placeholder.jpg')}" alt="${escapeHtmlAttr(displayName)}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
                <span class="pm-alt-name">${escapeHtmlAttr(displayName)}</span>
                <span class="pm-alt-price">${aPriceHtml}</span>
              </button>
            `;
          }).join('')}
        </div>
        <div class="pm-alt-hint">Tap an item to see its details.</div>
      </div>
    `
    : '';

  const modal = document.createElement('div');
  modal.id = 'gsProductModal';
  modal.className = 'product-modal';
  modal.innerHTML = `
    <div class="pm-backdrop"></div>
    <div class="pm-panel" role="dialog" aria-modal="true" aria-label="${escapeHtmlAttr(product.name)}">
      <button class="pm-close" type="button" aria-label="Close">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>

      <div class="pm-hero" id="pmHero">
        <img class="pm-image" src="${escapeHtmlAttr(product.image)}" alt="${escapeHtmlAttr(product.name)}" style="${!inStock ? 'filter: grayscale(100%); opacity: 0.7;' : ''}" onerror="this.src='img/placeholder.jpg'" />
        ${isOnActiveSpecial && inStock ? `<span class="pm-badge"><i class="fas fa-bolt" aria-hidden="true"></i> ${escapeHtmlAttr(product.tag || 'Special')}</span>` : ''}
        ${!inStock ? `<span class="pm-badge" style="background:#dc2626;"><i class="fas fa-ban" aria-hidden="true"></i> Out of Stock</span>` : ''}
      </div>

      <div class="pm-body">
        ${product.store ? `<div class="pm-store"><i class="fas fa-store" aria-hidden="true"></i> ${escapeHtmlAttr(product.store)}</div>` : ''}
        <h2 class="pm-name">${escapeHtmlAttr(product.name)}</h2>
        ${product.desc ? `<p class="pm-desc">${escapeHtmlAttr(product.desc)}</p>` : ''}
        <div class="pm-price">${priceHtml}</div>

        <div class="pm-quantity-row" style="${!inStock ? 'opacity: 0.4; pointer-events: none;' : ''}">
          <span class="pm-quantity-label">Quantity</span>
          <div class="pm-quantity">
            <button type="button" class="pm-qty-btn" data-delta="-1" aria-label="Decrease quantity">
              <i class="fas fa-minus" aria-hidden="true"></i>
            </button>
            <span class="pm-qty-value">1</span>
            <button type="button" class="pm-qty-btn" data-delta="1" aria-label="Increase quantity">
              <i class="fas fa-plus" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        ${altHtml}
      </div>

      <div class="pm-footer ${isStandaloneStorePage() ? '' : 'pm-footer-dual'}">
        ${!isStandaloneStorePage() ? `
          <button type="button" class="pm-visit-btn" id="pmVisitBtn">
            <i class="fas fa-store" aria-hidden="true"></i>
            <span>Visit Store</span>
          </button>
        ` : ''}
        
        <button type="button" class="pm-add-btn" id="pmAddBtn" ${!inStock ? 'disabled style="background:var(--text-muted);cursor:not-allowed;box-shadow:none;"' : ''}>
          <i class="fas fa-shopping-bag" aria-hidden="true"></i>
          <span>${!inStock ? 'Out of Stock' : `Add — R${effectivePrice.toFixed(2)}`}</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  document.body.style.overflow = 'hidden';

  const close = () => closeProductModal();

  modal.querySelector('.pm-close').addEventListener('click', close);
  modal.querySelector('.pm-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', esc);
    }
  });

  const hero = modal.querySelector('#pmHero');
  const heroImg = modal.querySelector('.pm-image');
  if (hero && heroImg) {
    hero.addEventListener('click', () => {
      openLightbox(heroImg.src, heroImg.alt || product.name);
    });
  }

  const qtyValue = modal.querySelector('.pm-qty-value');
  const addBtn = modal.querySelector('#pmAddBtn');
  
  const updateQtyDisplay = () => {
    qtyValue.textContent = _modalState.quantity;
    if (inStock) {
      const newTotal = (effectivePrice * _modalState.quantity).toFixed(2);
      addBtn.querySelector('span').textContent = `Add to Cart — R${newTotal}`;
    }
  };

  modal.querySelectorAll('.pm-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!inStock) return;
      const delta = parseInt(btn.dataset.delta, 10);
      const next = _modalState.quantity + delta;
      if (next < 1 || next > 99) return;
      _modalState.quantity = next;
      updateQtyDisplay();
    });
  });

  const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  modal.querySelectorAll('.pm-alt-item').forEach(btn => {
    if (!isTouchDevice) {
      btn.addEventListener('mouseenter', () => showAltTooltip(btn));
      btn.addEventListener('mouseleave', () => hideAltTooltip());
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      hideAltTooltip();

      // FIRST: Try to parse the JSON directly from the button (Works on all pages now)
      const altJson = btn.dataset.altJson;
      if (altJson) {
        try {
          const altProduct = JSON.parse(altJson);
          
          // If the parent modal has otherSpecials, we must pass the full array
          // to the new item so it can build its own rail.
          if (product.otherSpecials) {
            // Get the full list of specials from the original product
            altProduct.otherSpecials = item.otherSpecials || product.otherSpecials;
          }

          openProductModal(altProduct);
          requestAnimationFrame(() => {
            const newModal = document.getElementById('gsProductModal');
            if (newModal) {
              const body = newModal.querySelector('.pm-body');
              if (body) body.scrollTop = 0;
            }
          });
          return; // Exit early, we did it!
        } catch (err) {
          console.warn('Could not parse alternative item:', err);
        }
      }

      // FALLBACK: If JSON fails, use the old memory lookup
      const altId = btn.dataset.altId;
      if (!altId) return;

      const altProduct = _allProducts.find(p => p.id === altId);
      if (!altProduct) return;

      openProductModal({
        ...altProduct,
        store: altProduct.store || altProduct.storeName || product.store,
        storeName: altProduct.storeName || altProduct.store || product.store,
        storeId: altProduct.storeId || product.storeId
      });

      requestAnimationFrame(() => {
        const newModal = document.getElementById('gsProductModal');
        if (newModal) {
          const body = newModal.querySelector('.pm-body');
          if (body) body.scrollTop = 0;
        }
      });
    });

    btn.addEventListener('focus', () => showAltTooltip(btn));
    btn.addEventListener('blur', () => hideAltTooltip());
  });

  modal.addEventListener('click', (e) => {
    if (!e.target.closest('.pm-alt-item')) hideAltTooltip();
  });

  addBtn.addEventListener('click', () => {
    if (!inStock) {
      showToast('This item is currently out of stock.');
      return;
    }
    addProductToCart(product, _modalState.quantity);
  });

  const visitBtn = modal.querySelector('#pmVisitBtn');
  if (visitBtn) {
    visitBtn.addEventListener('click', () => {
      if (!product.store) {
        showToast('Store information not available.');
        return;
      }
      const storeSlug = product.store.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      window.location.href = `/store/${storeSlug}`;
    });
  }
}

// ============================================================
//  LIGHTBOX
// ============================================================
function openLightbox(src, alt) {
  const existing = document.getElementById('gsPmLightbox');
  if (existing) existing.remove();

  const lb = document.createElement('div');
  lb.id = 'gsPmLightbox';
  lb.className = 'pm-lightbox';
  lb.innerHTML = `
    <img class="pm-lightbox-img" src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt || '')}" onerror="this.src='img/placeholder.jpg'" />
    <button class="pm-lightbox-close" type="button" aria-label="Close image">
      <i class="fas fa-times" aria-hidden="true"></i>
    </button>
  `;
  document.body.appendChild(lb);
  requestAnimationFrame(() => lb.classList.add('open'));

  const close = () => {
    lb.classList.remove('open');
    document.removeEventListener('keydown', escHandler);
    setTimeout(() => lb.remove(), 220);
  };

  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);

  lb.addEventListener('click', close);
}

// ============================================================
//  CLOSE PRODUCT MODAL
// ============================================================
export function closeProductModal() {
  const modal = document.getElementById('gsProductModal');
  if (!modal) return;
  hideAltTooltip();
  modal.classList.remove('open');
  setTimeout(() => {
    modal.remove();
    const listingOpen = document.querySelector('.gs-listing-modal.open');
    const installOpen = document.querySelector('.install-sheet.open');
    const announceOpen = document.querySelector('.announcement-sheet.open');
    const cartOpen = document.querySelector('.cart-modal.open');
    if (!listingOpen && !installOpen && !announceOpen && !cartOpen) {
      document.body.style.overflow = '';
    }
  }, 300);
}

// ============================================================
//  ADD TO CART
// ============================================================
function addProductToCart(product, quantity) {
  if (product.stock === false) {
    showToast('This item is currently out of stock.');
    return;
  }

  const storeName = product.store || product.storeName || '';
  const storeId = product.storeId || null;
  const cartId = product.productId || product.id;

  const cartProduct = {
    id: cartId,
    productId: product.productId || null,
    name: product.name,
    price: Number(product.price) || 0,
    image: product.image,
    category: product.category || 'Uncategorized'
  };

  const cart = getCart();

  if (cart.length > 0 && cart[0].store !== storeName) {
    const currentStore = cart[0].store || 'another store';
    const ok = confirm(
      `Your cart has items from "${currentStore}".\n\nDo you want to clear your cart and add items from "${storeName}" instead?`
    );
    if (!ok) return;
    clearCart();
  }

  const existing = cart.find(i =>
    (i.productId && product.productId && i.productId === product.productId) ||
    i.id === cartId
  );

  if (existing) {
    existing.quantity = (existing.quantity || 1) + quantity;
    existing.price = Number(product.price) || existing.price || 0;
    if (product.productId) existing.productId = product.productId;
    saveCart(cart);
    showToast(`${quantity} × ${product.name} added to cart!`);
    setTimeout(closeProductModal, 400);
    return;
  }

  const result = addToCart(cartProduct, quantity, storeName, storeId);

  if (!result || !result.success) {
    showToast(result?.message || 'Could not add to cart.');
    return;
  }

  showToast(result.message);
  setTimeout(closeProductModal, 400);
}

// ============================================================
//  TOOLTIP
// ============================================================
function showAltTooltip(tile) {
  clearTimeout(_altTooltipTimer);
  if (!_altTooltipEl) {
    _altTooltipEl = document.createElement('div');
    _altTooltipEl.className = 'pm-alt-info';
    document.body.appendChild(_altTooltipEl);
  }
  const name = tile.dataset.altName || '';
  const desc = tile.dataset.altDesc || '';
  const price = tile.dataset.altPrice || '';
  
  _altTooltipEl.innerHTML = `
    <span class="pm-alt-info-name">${escapeHtmlAttr(name)}</span>
    ${desc ? `<span class="pm-alt-info-desc">${escapeHtmlAttr(desc)}</span>` : ''}
    <span class="pm-alt-info-price">${escapeHtmlAttr(price)}</span>
    <span class="pm-alt-info-hint">Tap to view this item</span>
  `;

  const rect = tile.getBoundingClientRect();
  _altTooltipEl.style.visibility = 'hidden';
  _altTooltipEl.classList.add('show');
  const ttRect = _altTooltipEl.getBoundingClientRect();

  let top = rect.top - ttRect.height - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - ttRect.width / 2;
  const maxLeft = window.innerWidth - ttRect.width - 8;
  if (left < 8) left = 8;
  if (left > maxLeft) left = maxLeft;

  _altTooltipEl.style.top = `${top}px`;
  _altTooltipEl.style.left = `${left}px`;
  _altTooltipEl.style.visibility = '';

  _altTooltipTimer = setTimeout(hideAltTooltip, TOOLTIP_HIDE_MS);
}

function hideAltTooltip() {
  clearTimeout(_altTooltipTimer);
  if (_altTooltipEl) {
    _altTooltipEl.classList.remove('show');
  }
}

// ============================================================
//  HELPER: Detect if we are on the store page
// ============================================================
function isStandaloneStorePage() {
  const path = window.location.pathname;
  const search = window.location.search;
  // If the URL is /store/something OR has ?id=something
  return path.includes('/store/') || search.includes('id=');
}

// ============================================================
//  HELPERS
// ============================================================
function escapeHtmlAttr(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}