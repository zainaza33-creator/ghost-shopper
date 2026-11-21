// ============================================================
//  order-confirmation.js — Ghost Shopper order confirmation
//  Verifies pending payments, loads order, renders receipt
//  with tracking steps, driver, and store details.
//
//  [REFACTOR] verifyPendingOrder now polls verifyPayment
//  because the webhook finalises the order asynchronously.
//  Driver photo is read from the order document, not the
//  now-restricted drivers collection.
// ============================================================

console.log('🚀 order-confirmation.js booting...');

import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, onSnapshot, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";
import {
  showToast, updateCartBadge, initGlobal,
  openAuthModal, updateNotificationBadge
} from './global.js';

const loadingScreen = document.getElementById('loadingScreen');
const confirmationContainer = document.getElementById('confirmationContainer');
const receiptOrderId = document.getElementById('receiptOrderId');
const confirmationStoreBadge = document.getElementById('confirmationStoreBadge');
const confirmationStoreName = document.getElementById('confirmationStoreName');
const confirmationHeroSub = document.getElementById('confirmationHeroSub');
const sendReceiptActions = document.getElementById('sendReceiptActions');

let orderId = null;
let pendingOrderId = null;
let token = null;
let currentOrder = null;
let currentOrderId = null;
let routeHandled = false;
let unsubscribeOrder = null;

// ============================================================
//  BOOTSTRAP
// ============================================================
window.addEventListener('load', () => {
  setTimeout(hideLoader, 400);
  setTimeout(hideLoader, 6000);

  try {
    const p = initGlobal();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.warn('initGlobal error (non-fatal):', err));
    }
  } catch (err) {
    console.warn('initGlobal threw (non-fatal):', err);
  }

  updateCartBadge();
  updateNotificationBadge();

  const urlParams = new URLSearchParams(window.location.search);
  orderId = urlParams.get('id');
  pendingOrderId = urlParams.get('pending');
  token = urlParams.get('token');
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
}

// ============================================================
//  AUTH — resolve once, then route
// ============================================================
auth.onAuthStateChanged((user) => {
  if (routeHandled) {
    if (user) {
      routeHandled = false;
      handleRoute(user);
    }
    return;
  }
  handleRoute(user);
});

function handleRoute(user) {
  routeHandled = true;

  if (pendingOrderId && token) {
    if (user) {
      verifyPendingOrder(pendingOrderId, token);
    } else {
      openAuthModal(() => window.location.reload());
    }
    return;
  }

  if (orderId) {
    if (user) {
      loadOrder(orderId);
    } else {
      openAuthModal(() => window.location.reload());
    }
    return;
  }

  renderError(
    'Order not found',
    'No order information was provided. Please check your orders page or contact support.',
    [{ label: 'My Orders', href: 'my-orders.html', primary: true }]
  );
}

// ============================================================
//  VERIFY PENDING PAYMENT — [REFACTOR] polls until the webhook
//  finalises the order, or times out with a "still confirming"
//  message. Never tells a paying customer that payment failed.
// ============================================================
async function verifyPendingOrder(pendingId, jwtToken) {
  if (window._verifying) return;
  window._verifying = true;

  try {
    confirmationContainer.innerHTML = `
      <div class="confirmation-loading">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span>Verifying your payment...</span>
      </div>
    `;

    const functions = getFunctions();
    const verifyPaymentFn = httpsCallable(functions, 'verifyPayment');

    let result = null;
    const MAX_ATTEMPTS = 6;
    const DELAY_MS = 2500;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await verifyPaymentFn({ pendingOrderId: pendingId, token: jwtToken });
        const d = r?.data || {};
        if (d.orderId) { result = d; break; }
        // pending: true → webhook not yet delivered. Retry.
      } catch (err) {
        const msg = err?.message || '';
        // Only terminal failures stop the loop.
        if (msg.includes('Payment failed')) throw err;
        if (msg.includes('Invalid payment confirmation token')) throw err;
        if (msg.includes('Token does not match')) throw err;
        if (msg.includes('Pending order not found')) throw err;
        if (msg.includes('Not your order')) throw err;
        // Otherwise transient — retry.
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    if (!result || !result.orderId) {
      // Do NOT claim failure. The webhook may still arrive.
      confirmationContainer.innerHTML = `
        <div class="confirmation-loading">
          <i class="fas fa-clock" aria-hidden="true"></i>
          <p style="margin-top:12px;font-size:0.95rem;color:var(--text-secondary);text-align:center;">
            Your payment is still being confirmed.<br>
            If it succeeds, your order will appear in
            <a href="my-orders.html" style="color:var(--orange);font-weight:700;">My Orders</a> shortly.
          </p>
        </div>
      `;
      return;
    }

    const orderData = result.orderData;
    const newOrderId = result.orderId;

    if (!result.alreadyProcessed) {
      localStorage.removeItem('ghostShopperCart');
      updateCartBadge();
      showToast('Payment confirmed. Your order is placed.');
    }

    currentOrder = orderData;
    currentOrderId = newOrderId;
    renderOrder(orderData, newOrderId);

    try {
      const newUrl = `${window.location.pathname}?id=${newOrderId}`;
      window.history.replaceState({}, '', newUrl);
    } catch (_) {}

  } catch (error) {
    console.error('verifyPendingOrder error:', error);
    let msg = 'Payment verification failed. Please contact support.';
    if (error.message) msg = error.message;
    if (error.details) msg = error.details;

    renderError(
      'Payment verification failed',
      msg,
      [
        { label: 'My Orders', href: 'my-orders.html', primary: true },
        { label: 'Go Home', href: 'index.html', primary: false }
      ]
    );
  } finally {
    window._verifying = false;
  }
}

// ============================================================
//  LOAD ORDER (direct id)
// ============================================================
function loadOrder(id) {
  if (!id) {
    renderError('Order not found', 'No order ID provided.');
    return;
  }

  if (unsubscribeOrder) { try { unsubscribeOrder(); } catch (_) {} }

  receiptOrderId.textContent = `#${id.slice(-6).toUpperCase()}`;

  confirmationContainer.innerHTML = `
    <div class="confirmation-loading">
      <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
      <span>Loading order details...</span>
    </div>
  `;

  unsubscribeOrder = onSnapshot(doc(db, 'orders', id), (snap) => {
    if (!snap.exists()) {
      renderError('Order not found', 'We could not find this order. It may have been removed.');
      return;
    }
    currentOrder = snap.data();
    currentOrderId = id;
    renderOrder(currentOrder, id);
  }, (error) => {
    console.error('onSnapshot error:', error);
    renderError('Error loading order', error.message || 'Please try again.', [
      { label: 'Retry', href: null, primary: true, onclick: () => location.reload() }
    ]);
  });

  window.addEventListener('beforeunload', () => {
    if (unsubscribeOrder) { try { unsubscribeOrder(); } catch (_) {} }
  });
}

// ============================================================
//  RENDER
// ============================================================
function renderOrder(order, orderId) {
  if (!order) return;

  const created = parseTimestamp(order.createdAt);
  const dateStr = created.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

  const storeName = order.store || 'Store';
  if (confirmationStoreBadge) confirmationStoreBadge.hidden = false;
  if (confirmationStoreName) confirmationStoreName.textContent = storeName;

  receiptOrderId.textContent = `#${orderId.slice(-6).toUpperCase()}`;

  const paymentStatus = order.paymentStatus || 'pending';
  const isTestMode = order.testMode === true;
  const isPaid = (paymentStatus === 'paid' || paymentStatus === 'test_mode' || isTestMode);

  let displayStatus = order.orderStatus || 'pending';
  if (isPaid && displayStatus === 'pending') displayStatus = 'confirmed';

  const statusFlow = [
    'pending',
    'confirmed',
    'packing',
    'packed',
    'ready',
    'assigned',
    'collected',
    'on_the_way',
    'delivered'
  ];
  const stepLabels = {
    pending: 'Order Sent to Store',
    confirmed: 'Order Confirmed',
    packing: 'Being Prepared',
    packed: 'Packed',
    ready: 'Ready for Collection',
    assigned: 'Ready for Dispatch',
    collected: 'Driver Collected',
    on_the_way: 'Driver On the Way',
    delivered: 'Delivered'
  };
  const stepIcons = [
    'fa-paper-plane',
    'fa-check',
    'fa-box',
    'fa-box-open',
    'fa-check-double',
    'fa-motorcycle',
    'fa-shipping-fast',
    'fa-road',
    'fa-flag-checkered'
  ];

  let currentIndex = statusFlow.indexOf(displayStatus);
  if (currentIndex === -1) currentIndex = 0;

  const trackingHtml = statusFlow.map((step, idx) => {
    const isCompleted = idx < currentIndex;
    const isActive = idx === currentIndex;
    let cls = 'pending';
    if (isCompleted) cls = 'completed';
    else if (isActive) cls = 'active';
    const icon = isCompleted ? 'fa-check' : stepIcons[idx];
    let timeText = '';
    if (isCompleted) timeText = 'Done';
    else if (isActive && displayStatus === 'delivered') timeText = 'Complete';
    else if (isActive) timeText = 'In progress';
    const rowCls = isActive ? 'is-active' : (isCompleted ? 'done' : '');
    return `
      <div class="tracking-step ${rowCls}">
        <div class="step-icon ${cls}">
          <i class="fas ${icon}"></i>
        </div>
        <div class="step-info">
          <div class="step-label">${stepLabels[step]}</div>
          ${timeText ? `<div class="step-time">${timeText}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const itemsHtml = (order.items && order.items.length)
    ? order.items.map(item => renderItem(item)).join('')
    : '<li>No items</li>';

  const subtotal = Number(order.subtotal || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const packagingFee = Number(order.packagingFee || 0);
  const packagingCount = Number(order.packagingCount || 0);
  const total = Number(order.total || 0);
  const address = order.deliveryAddress?.street || 'No address provided';
  const timeSlot = order.timeSlot?.display || order.timeSlot || 'Not set';
  const notes = order.notes || '';

  let statusLabel = displayStatus.replace(/_/g, ' ').toUpperCase();
  const statusClass = 'status-' + displayStatus;
  if (displayStatus === 'pending') statusLabel = isPaid ? 'PAID' : 'PAYMENT PENDING';
  else if (displayStatus === 'delivered') statusLabel = 'DELIVERED';

  const storeContactHtml = `
    <div class="order-row">
      <span class="label">Store Phone</span>
      <span class="value store-phone-display">Loading...</span>
    </div>
  `;

  // Driver row — [REFACTOR] photo now comes from order.driverPhoto
  let driverHtml = '';
  if (order.driverId && order.driverName) {
    const driverName = order.driverName;
    const driverPhone = order.driverPhone || order.driverId;
    const showPhoto = (displayStatus === 'assigned' || displayStatus === 'on_the_way' || displayStatus === 'delivered' || displayStatus === 'collected');
    const photoId = `driverPhoto_${orderId}`;
    driverHtml = `
      <div class="order-row driver-row">
        <span class="label">Driver</span>
        <span class="value">
          <span class="driver-info-text">
            <i class="fas fa-motorcycle" style="color:var(--orange);margin-right:6px;"></i>
            ${escapeHtml(driverName)}
            ${driverPhone ? ` · <a href="tel:${driverPhone}">${escapeHtml(driverPhone)}</a>` : ''}
          </span>
          ${showPhoto ? `<span class="driver-photo-container" id="${photoId}">Loading...</span>` : ''}
        </span>
      </div>
    `;
    if (showPhoto) {
      const photoEl = document.getElementById(photoId);
      if (photoEl) {
        const url = order.driverPhoto || '';
        if (url) {
          photoEl.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(driverName)}" class="driver-profile-photo" onerror="this.style.display='none'" />`;
        } else {
          photoEl.textContent = '';
        }
      }
    }
  }

  const notesHtml = notes ? `
    <div class="order-row">
      <span class="label">Notes</span>
      <span class="value">${escapeHtml(notes)}</span>
    </div>
  ` : '';

  let refundHtml = '';
  if (order.refundAmount && order.refundAmount > 0) {
    refundHtml = `
      <div class="order-row refund-row">
        <span class="label"><i class="fas fa-undo-alt" style="color:var(--red);"></i> Refund</span>
        <span class="value" style="color:var(--red);font-weight:700;">- R${Number(order.refundAmount).toFixed(2)} (to wallet)</span>
      </div>
    `;
  }

  if (confirmationHeroSub) {
    if (displayStatus === 'delivered') {
      confirmationHeroSub.textContent = 'Your order has been delivered. Enjoy!';
    } else if (displayStatus === 'assigned') {
      confirmationHeroSub.textContent = 'Your order is packed and ready for dispatch.';
    } else if (isPaid) {
      confirmationHeroSub.textContent = "Your order has been sent to the store. You'll receive updates shortly.";
    } else {
      confirmationHeroSub.textContent = "We're waiting for your payment confirmation.";
    }
  }

  if (sendReceiptActions) sendReceiptActions.hidden = false;

  confirmationContainer.innerHTML = `
    <div class="order-details-card">
      <div class="order-row">
        <span class="label">Order Date</span>
        <span class="value">${dateStr} at ${timeStr}</span>
      </div>
      <div class="order-row">
        <span class="label">Store</span>
        <span class="value"><i class="fas fa-store"></i> ${escapeHtml(storeName)}</span>
      </div>
      ${storeContactHtml}
      <div class="order-row">
        <span class="label">Delivery Address</span>
        <span class="value"><i class="fas fa-map-pin"></i> ${escapeHtml(address)}</span>
      </div>
      <div class="order-row">
        <span class="label">Time Slot</span>
        <span class="value"><i class="fas fa-clock"></i> ${escapeHtml(timeSlot)}</span>
      </div>
      ${notesHtml}
      ${driverHtml}
      ${refundHtml}
      <div class="order-row">
        <span class="label">Status</span>
        <span class="value"><span class="order-status-badge ${statusClass}">${statusLabel}</span></span>
      </div>
    </div>

    <div>
      <div class="section-label" style="font-weight:700;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-secondary);margin-bottom:8px;">
        Items
      </div>
      <ul class="order-items">${itemsHtml}</ul>
    </div>

    <div class="order-totals">
      <div class="total-row"><span>Subtotal</span><span>R${subtotal.toFixed(2)}</span></div>
      ${packagingCount > 0 ? `<div class="total-row"><span>Packaging × ${packagingCount}</span><span>R${packagingFee.toFixed(2)}</span></div>` : ''}
      <div class="total-row"><span>Delivery Fee</span><span>R${deliveryFee.toFixed(2)}</span></div>
      <div class="total-row grand-total"><span>Total</span><span class="amount">R${total.toFixed(2)}</span></div>
    </div>

    <div class="tracking-section">
      <h3><i class="fas fa-route"></i> Order Progress</h3>
      <div class="tracking-steps">${trackingHtml}</div>
    </div>
  `;

  if (order.store) {
    getDocs(query(collection(db, 'stores'), where('name', '==', order.store)))
      .then((snap) => {
        if (snap.empty) {
          const el = document.querySelector('.store-phone-display');
          if (el) el.textContent = 'Not available';
          return;
        }
        const storePhone = snap.docs[0].data().phone || '';
        const el = document.querySelector('.store-phone-display');
        if (el) {
          el.innerHTML = storePhone
            ? `<a href="tel:${storePhone.replace(/\s/g, '')}"><i class="fas fa-phone"></i> ${escapeHtml(storePhone)}</a>`
            : 'Not available';
        }
      })
      .catch(() => {
        const el = document.querySelector('.store-phone-display');
        if (el) el.textContent = 'Not available';
      });
  }

  document.getElementById('sendWhatsApp')?.addEventListener('click', () => sendReceipt('whatsapp', order, orderId));
  document.getElementById('sendEmail')?.addEventListener('click', () => sendReceipt('email', order, orderId));
}

// ============================================================
//  RENDER ITEM
// ============================================================
function renderItem(item) {
  let displayItem = item;
  let isAlternate = false;
  let isOutOfStock = false;
  let statusText = '';

  if (item.alternateAccepted === true && item.alternate) {
    displayItem = { ...item.alternate, quantity: item.quantity };
    isAlternate = true;
    statusText = 'Alternate';
  } else if (item.accepted === false && !item.alternateAccepted) {
    isOutOfStock = true;
    statusText = 'Out of Stock';
  } else if (item.accepted === true) {
    statusText = 'In Stock';
  }

  const imgSrc = displayItem.image || 'img/placeholder.jpg';
  const itemName = displayItem.name || 'Item';
  const price = Number(displayItem.price || 0);
  const qty = Number(displayItem.quantity || 1);

  let statusHtml = '';
  if (statusText) {
    if (isAlternate) {
      statusHtml = `
        <div class="item-status-badge alternate"><i class="fas fa-exchange-alt"></i> ${statusText}</div>
        <div class="item-original">
          <span class="original-label">Original:</span>
          <span class="original-name">${escapeHtml(item.name || '')}</span>
          <span class="original-price">(R${Number(item.price || 0).toFixed(2)})</span>
        </div>
      `;
    } else if (isOutOfStock) {
      const refundAmount = (Number(item.price || 0) * qty);
      statusHtml = `
        <div class="item-status-badge out-of-stock"><i class="fas fa-times-circle"></i> ${statusText}</div>
        <div class="item-refund"><i class="fas fa-undo-alt"></i> Refund: R${refundAmount.toFixed(2)} to wallet</div>
      `;
    } else {
      statusHtml = `<div class="item-status-badge in-stock"><i class="fas fa-check-circle"></i> ${statusText}</div>`;
    }
  }

  return `
    <li>
      <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(itemName)}" loading="lazy" onerror="this.src='img/placeholder.jpg'" />
      <div class="item-detail">
        <span class="item-name">${escapeHtml(itemName)}</span>
        <span class="item-qty">× ${qty}</span>
        <span class="item-total">R${(price * qty).toFixed(2)}</span>
      </div>
      ${statusHtml}
    </li>
  `;
}

// ============================================================
//  SEND RECEIPT
// ============================================================
function sendReceipt(method, order, orderId) {
  const storeName = order.store || 'Ghost Shopper';
  const total = Number(order.total || 0);
  const items = (order.items || []).map(i => {
    const name = (i.alternateAccepted && i.alternate) ? i.alternate.name : i.name;
    return `• ${name} × ${i.quantity}`;
  }).join('\n');
  const message =
`Order Receipt — ${storeName}

Order #${orderId.slice(-6).toUpperCase()}
Date: ${new Date().toLocaleString()}

Items:
${items}

Total: R${total.toFixed(2)}

Thanks for shopping with Ghost Shopper!`;

  if (method === 'whatsapp') {
    const phone = (order.customerPhone || '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  } else if (method === 'email') {
    const subject = `Your Order Receipt #${orderId.slice(-6).toUpperCase()}`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`, '_blank');
  }
  showToast(`Opening ${method}...`);
}

// ============================================================
//  RENDER ERROR
// ============================================================
function renderError(title, message, actions = []) {
  if (!confirmationContainer) return;
  const actionsHtml = actions.map(a => {
    if (a.href) {
      return `<a href="${a.href}" class="${a.primary ? 'btn-primary' : 'btn-secondary'}">${escapeHtml(a.label)}</a>`;
    }
    const id = 'errBtn_' + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el && typeof a.onclick === 'function') el.addEventListener('click', a.onclick);
    }, 0);
    return `<button id="${id}" class="${a.primary ? 'btn-primary' : 'btn-secondary'}" type="button">${escapeHtml(a.label)}</button>`;
  }).join('');

  confirmationContainer.innerHTML = `
    <div class="confirmation-error">
      <i class="fas fa-exclamation-triangle"></i>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${actionsHtml}
    </div>
  `;
}

// ============================================================
//  HELPERS
// ============================================================
function parseTimestamp(ts) {
  if (!ts) return new Date();
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000);
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? new Date() : d;
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

window.addEventListener('storage', (e) => {
  if (e.key === 'ghostShopperCart') updateCartBadge();
});