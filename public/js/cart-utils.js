// ============================================================
//  CART-UTILS.JS - Shared cart functions
//  Used by index.js, store.js, stores.js, cart.js, global.js,
//  and product-modal.js
// ============================================================

const CART_KEY = 'ghostShopperCart';

// ========== Get Cart ==========
export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

// ========== Save Cart ==========
export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

// ========== Clear Cart ==========
export function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartBadge();
}

// ========== Get Cart Total ==========
export function getCartTotal() {
  const cart = getCart();
  return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

// ========== Get Cart Item Count ==========
export function getCartItemCount() {
  const cart = getCart();
  return cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

// ========== Update Cart Badge ==========
export function updateCartBadge() {
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);

  const badge = document.getElementById('cart-count');
  const bottomBadge = document.getElementById('bottom-cart-count');

  if (badge) {
    badge.textContent = total;
    badge.style.display = total > 0 ? 'block' : 'none';
  }

  if (bottomBadge) {
    bottomBadge.textContent = total;
    bottomBadge.classList.toggle('show', total > 0);
  }

  updateCartIconState(cart);
}

// ========== Update Cart Icon State ==========
export function updateCartIconState(cart) {
  const cartData = cart || getCart();
  const total = cartData.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const isEmpty = total === 0;

  const desktopBtn = document.getElementById('desktopCartBtn');
  if (desktopBtn) {
    desktopBtn.classList.toggle('cart-empty', isEmpty);
  }

  const mobileBtn = document.getElementById('mobileCartBtn');
  if (mobileBtn) {
    mobileBtn.classList.toggle('cart-empty', isEmpty);
  }
}

// ========== ACTIVE PRICE HELPER ==========
export function getActivePrice(product) {
  if (!product) return 0;

  const basePrice = Number(product.price) || 0;

  if (product.onSpecial !== true) return basePrice;

  const specialPrice = Number(product.specialPrice);
  if (!specialPrice || specialPrice <= 0) return basePrice;

  const now = new Date();

  const endRaw = product.specialEndDate;
  const end = endRaw?.toDate ? endRaw.toDate()
            : endRaw ? new Date(endRaw)
            : null;
  if (end && !isNaN(end) && end < now) return basePrice;

  const startRaw = product.specialStartDate;
  const start = startRaw?.toDate ? startRaw.toDate()
              : startRaw ? new Date(startRaw)
              : null;
  if (start && !isNaN(start) && start > now) return basePrice;

  return specialPrice;
}

// Boolean helper — is the special currently active?
export function isSpecialActive(product) {
  if (!product) return false;
  if (product.onSpecial !== true) return false;
  const sp = Number(product.specialPrice);
  if (!sp || sp <= 0) return false;
  return getActivePrice(product) === sp;
}

// ========== Add Item to Cart ==========
export function addToCart(product, quantity = 1, storeName, storeId) {
  // ---- HARD STOCK BLOCK ----
  // If the product is explicitly out of stock, reject it immediately.
  // The UI should already block this, but this is the final safety net.
  if (product.stock === false) {
    return { success: false, message: `${product.name} is out of stock.` };
  }
  // ---------------------------

  const cart = getCart();

  if (cart.length > 0 && cart[0].store !== storeName) {
    return { success: false, message: 'You can only shop from one store at a time.' };
  }

  const cartId = product.id;
  const pid = product.productId || null;

  const existing = cart.find(item =>
    (pid && item.productId && item.productId === pid) ||
    item.id === cartId
  );

  if (existing) {
    existing.quantity = (existing.quantity || 1) + quantity;
    existing.basePrice = Number(product.price) || existing.basePrice || 0;
    if (pid) existing.productId = pid;
  } else {
    cart.push({
      id: cartId,
      productId: pid,
      name: product.name,
      store: storeName,
      storeId: storeId,
      basePrice: Number(product.price) || 0,
      price: Number(product.price) || 0,
      quantity: quantity,
      image: product.image || 'img/placeholder.jpg',
      category: product.category || 'Uncategorized'
    });
  }

  saveCart(cart);
  return { success: true, message: `${quantity} × ${product.name} added to cart!` };
}

// ========== Remove Item from Cart ==========
export function removeFromCart(index) {
  const cart = getCart();
  if (index >= 0 && index < cart.length) {
    const removed = cart.splice(index, 1);
    saveCart(cart);
    return removed[0];
  }
  return null;
}

// ========== Update Item Quantity ==========
export function updateQuantity(index, quantity) {
  const cart = getCart();
  if (index >= 0 && index < cart.length) {
    if (quantity <= 0) {
      return removeFromCart(index);
    }
    cart[index].quantity = quantity;
    saveCart(cart);
    return cart[index];
  }
  return null;
}

// ========== Check if Item is in Cart ==========
export function isInCart(productId) {
  const cart = getCart();
  return cart.some(item => item.id === productId || item.productId === productId);
}

// ========== Get Cart Item by ID ==========
export function getCartItem(productId) {
  const cart = getCart();
  return cart.find(item => item.id === productId || item.productId === productId);
}

// ========== Get Cart Store Info ==========
export function getCartStore() {
  const cart = getCart();
  if (cart.length === 0) return null;
  return {
    name: cart[0].store,
    id: cart[0].storeId || null
  };
}

// ============================================================
//  MIX SPECIALS BY CATEGORY — round-robin
// ============================================================
export function mixSpecialsByCategory(specials) {
  if (!Array.isArray(specials) || specials.length <= 1) {
    return Array.isArray(specials) ? [...specials] : [];
  }

  const UNCATEGORISED = '__uncategorised__';

  const groups = new Map();
  const firstSeenAt = new Map();

  specials.forEach((s, idx) => {
    let key = (s && typeof s.category === 'string') ? s.category.trim() : '';
    if (!key || key.toLowerCase() === 'uncategorized') {
      key = UNCATEGORISED;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      firstSeenAt.set(key, idx);
    }
    groups.get(key).push(s);
  });

  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === UNCATEGORISED) return 1;
    if (b === UNCATEGORISED) return -1;
    return firstSeenAt.get(a) - firstSeenAt.get(b);
  });

  const queues = orderedKeys.map(k => groups.get(k));
  const out = [];
  let exhausted = false;

  while (!exhausted) {
    exhausted = true;
    for (const q of queues) {
      if (q.length) {
        out.push(q.shift());
        exhausted = false;
      }
    }
  }

  return out;
}

// ========== Listen for cart changes from other tabs ==========
window.addEventListener('storage', (e) => {
  if (e.key === CART_KEY) {
    updateCartBadge();
  }
});

// ========== Initialize on load ==========
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
});

// ========== Expose to window for inline use ==========
window.getCart = getCart;
window.saveCart = saveCart;
window.clearCart = clearCart;
window.updateCartBadge = updateCartBadge;
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.getActivePrice = getActivePrice;
window.isSpecialActive = isSpecialActive;
window.mixSpecialsByCategory = mixSpecialsByCategory;