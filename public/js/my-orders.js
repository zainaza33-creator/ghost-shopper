// ============================================================
//  my-orders.js — Ghost Shopper order history
//  Loads user's orders, renders expandable cards, review modal,
//  reorder, send receipt.
//
//  [REFACTOR] fetchDriverPhotos now reads order.driverPhoto
//  instead of fetching drivers/{driverId}, which is no longer
//  readable by customers.
// ============================================================

console.log('🚀 my-orders.js booting...');

import { auth, db } from './firebase-config.js';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, updateDoc, addDoc, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  showToast, updateCartBadge, getCart, saveCart,
  initGlobal, openAuthModal, updateNotificationBadge
} from './global.js';

const loadingScreen = document.getElementById('loadingScreen');
const ordersContainer = document.getElementById('ordersContainer');

const reviewModal = document.getElementById('reviewModal');
const reviewComment = document.getElementById('reviewComment');
const reviewSubmitBtn = document.getElementById('reviewSubmit');

let currentUser = null;
let userData = null;
let unsubscribeOrders = null;
let reviewOrderId = null;
let ordersMap = new Map();

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

  auth.onAuthStateChanged(handleAuthState);
  initReviewModal();
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
}

function getStatusLabel(displayStatus, isPaid) {
  const map = {
    pending: isPaid ? 'PAID' : 'PAYMENT PENDING',
    confirmed: 'CONFIRMED',
    packing: 'BEING PREPARED',
    packed: 'PACKED',
    ready: 'READY FOR COLLECTION',
    assigned: 'READY FOR DISPATCH',
    collected: 'DRIVER COLLECTED',
    on_the_way: 'DRIVER ON THE WAY',
    delivered: 'DELIVERED',
    refunded: 'REFUNDED',
    cancelled: 'CANCELLED'
  };
  return map[displayStatus] || displayStatus.replace(/_/g, ' ').toUpperCase();
}

function handleAuthState(user) {
  if (!user) {
    currentUser = null;
    userData = null;
    if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
    showSignInPrompt();
    return;
  }

  currentUser = user;
  getDoc(doc(db, 'users', user.uid))
    .then(snap => {
      userData = snap.exists() ? snap.data() : { phone: user.phoneNumber || '' };
      loadOrders(user.uid);
    })
    .catch(err => {
      console.error('Error loading user data:', err);
      userData = { phone: user.phoneNumber || '' };
      loadOrders(user.uid);
    });
}

function showSignInPrompt() {
  if (!ordersContainer) return;
  ordersContainer.innerHTML = `
    <div class="signin-prompt">
      <div class="prompt-icon">
        <i class="fas fa-user-lock" aria-hidden="true"></i>
      </div>
      <h2>Sign in to view your orders</h2>
      <p>Access your order history, track deliveries, and manage your account.</p>
      <button id="signInPromptBtn" class="signin-btn" type="button">
        <i class="fas fa-phone-alt" aria-hidden="true"></i>
        <span>Sign in with Phone</span>
      </button>
      <div class="prompt-footer">New user? Sign in to create your account.</div>
    </div>
  `;
  document.getElementById('signInPromptBtn')?.addEventListener('click', () => {
    openAuthModal(() => location.reload());
  });
}

function loadOrders(userId) {
  if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }

  const ordersRef = collection(db, 'orders');
  const q = query(
    ordersRef,
    where('customerId', '==', userId),
    orderBy('createdAt', 'desc')
  );

  ordersContainer.innerHTML = `
    <div class="orders-loading">
      <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
      <span>Loading your orders...</span>
    </div>
  `;

  unsubscribeOrders = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      renderEmpty();
      return;
    }

    ordersMap = new Map();
    const cards = [];
    snapshot.forEach(docSnap => {
      const order = docSnap.data();
      ordersMap.set(docSnap.id, order);
      cards.push(renderOrderCard(order, docSnap.id));
    });

    ordersContainer.innerHTML = cards.join('');
    wireCardEvents();
    fetchDriverPhotos();
  }, (error) => {
    console.error('Error loading orders:', error);
    ordersContainer.innerHTML = `
      <div class="empty-orders">
        <i class="fas fa-exclamation-triangle" style="color:var(--red);background:#fee2e2;" aria-hidden="true"></i>
        <h2>Couldn't load orders</h2>
        <p>${escapeHtml(error.message || 'Please try again.')}</p>
        <button class="btn-primary" type="button" onclick="location.reload()">
          <i class="fas fa-sync-alt" aria-hidden="true"></i>
          <span>Retry</span>
        </button>
      </div>
    `;
  });
}

function renderEmpty() {
  ordersContainer.innerHTML = `
    <div class="empty-orders">
      <i class="fas fa-box-open" aria-hidden="true"></i>
      <h2>No orders yet</h2>
      <p>You haven't placed any orders yet. Start shopping to see them here.</p>
      <a href="index.html" class="btn-primary">
        <i class="fas fa-shopping-bag" aria-hidden="true"></i>
        <span>Start Shopping</span>
      </a>
    </div>
  `;
}

function renderOrderCard(order, orderId) {
  const created = parseTimestamp(order.createdAt);
  const dateStr = created.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

  const storeName = order.store || 'Store';
  const total = Number(order.total || 0);
  const address = order.deliveryAddress?.street || 'No address';
  const timeSlot = order.timeSlot?.display || order.timeSlot || 'Not set';

  const paymentStatus = order.paymentStatus || 'pending';
  const isTestMode = order.testMode === true;
  const isPaid = (paymentStatus === 'paid' || paymentStatus === 'test_mode' || isTestMode);

  let displayStatus = order.orderStatus || 'pending';
  if (isPaid && displayStatus === 'pending') displayStatus = 'confirmed';
  const isDelivered = displayStatus === 'delivered';

  const statusClass = 'status-' + displayStatus;
  const statusLabel = getStatusLabel(displayStatus, isPaid);

  const itemsSummary = (order.items && order.items.length)
    ? order.items.map(i => i.alternateAccepted && i.alternate ? i.alternate.name : i.name).join(', ')
    : 'No items';

  const itemsHtml = (order.items && order.items.length)
    ? order.items.map(item => renderOrderItem(item)).join('')
    : '<li>No items</li>';

  const subtotal = Number(order.subtotal || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const packagingFee = Number(order.packagingFee || 0);
  const packagingCount = Number(order.packagingCount || 0);

  let driverHtml = '';
  if (order.driverId && order.driverName) {
    const driverName = order.driverName;
    const driverPhone = order.driverPhone || order.driverId;
    const showPhoto = (displayStatus === 'assigned' || displayStatus === 'collected' || displayStatus === 'on_the_way' || displayStatus === 'delivered');
    const photoId = `driverPhoto_${orderId}`;
    driverHtml = `
      <div class="order-detail-section driver-section"
           data-driver-id="${escapeHtml(order.driverId)}"
           data-order-id="${orderId}">
        <div class="section-title"><i class="fas fa-motorcycle" style="color:var(--orange);" aria-hidden="true"></i> Driver</div>
        <div class="driver-content">
          <span class="driver-info-text">
            <i class="fas fa-motorcycle" style="color:var(--orange);margin-right:6px;" aria-hidden="true"></i>
            ${escapeHtml(driverName)}
            ${driverPhone ? ` · <a href="tel:${driverPhone}" style="color:var(--orange);font-weight:600;">${escapeHtml(driverPhone)}</a>` : ''}
          </span>
          ${showPhoto ? `<span class="driver-photo-container" id="${photoId}">Loading...</span>` : ''}
        </div>
      </div>
    `;
  }

  let actionsHtml = '';
  if (isDelivered) {
    const hasReviewed = order.hasReview === true;
    actionsHtml = `
      <button class="action-btn send-btn whatsapp" data-action="whatsapp" data-orderid="${orderId}" type="button">
        <i class="fab fa-whatsapp" aria-hidden="true"></i> WhatsApp
      </button>
      <button class="action-btn send-btn email" data-action="email" data-orderid="${orderId}" type="button">
        <i class="fas fa-envelope" aria-hidden="true"></i> Email
      </button>
      <button class="action-btn reorder-btn" data-action="reorder" data-orderid="${orderId}" type="button">
        <i class="fas fa-redo" aria-hidden="true"></i> Reorder
      </button>
      <button class="action-btn review-btn" data-action="review" data-orderid="${orderId}" type="button" ${hasReviewed ? 'disabled' : ''}>
        <i class="fas fa-star" aria-hidden="true"></i> ${hasReviewed ? 'Reviewed' : 'Review'}
      </button>
    `;
  } else {
    actionsHtml = `
      <a href="order-confirmation.html?id=${orderId}" class="action-btn track-btn">
        <i class="fas fa-route" aria-hidden="true"></i> Track Order
      </a>
      <button class="action-btn send-btn whatsapp" data-action="whatsapp" data-orderid="${orderId}" type="button">
        <i class="fab fa-whatsapp" aria-hidden="true"></i> WhatsApp
      </button>
      <button class="action-btn send-btn email" data-action="email" data-orderid="${orderId}" type="button">
        <i class="fas fa-envelope" aria-hidden="true"></i> Email
      </button>
    `;
  }

  return `
    <article class="order-card" data-order-id="${orderId}">
      <div class="order-card-header">
        <div class="order-card-header-left">
          <span class="order-id">Order #${orderId.slice(-6).toUpperCase()}</span>
          <span class="order-date">${dateStr} · ${timeStr}</span>
        </div>
        <span class="order-status-badge ${statusClass}">${statusLabel}</span>
        <button class="order-card-toggle" type="button" aria-label="Toggle order details">
          <i class="fas fa-chevron-down" aria-hidden="true"></i>
        </button>
      </div>

      <div class="order-card-summary">
        <div class="order-summary-row">
          <span class="label">Store</span>
          <span class="value"><i class="fas fa-store" aria-hidden="true"></i> ${escapeHtml(storeName)}</span>
        </div>
        <div class="order-summary-row">
          <span class="label">Items</span>
          <span class="value">${escapeHtml(itemsSummary)}</span>
        </div>
        <div class="order-summary-row">
          <span class="label">Total</span>
          <span class="value order-total-amount">R${total.toFixed(2)}</span>
        </div>
      </div>

      <div class="order-card-details">
        <div class="order-detail-section">
          <div class="section-title">Delivery</div>
          <div class="section-content"><i class="fas fa-map-pin" aria-hidden="true"></i> ${escapeHtml(address)}</div>
          <div class="section-content"><i class="fas fa-clock" aria-hidden="true"></i> ${escapeHtml(timeSlot)}</div>
        </div>

        ${driverHtml}

        <div class="order-detail-section">
          <div class="section-title">Items</div>
          <ul class="order-items-list">${itemsHtml}</ul>
        </div>

        <div class="order-totals-expanded">
          <div class="total-row"><span>Subtotal</span><span>R${subtotal.toFixed(2)}</span></div>
          ${packagingCount > 0 ? `<div class="total-row"><span>Packaging × ${packagingCount}</span><span>R${packagingFee.toFixed(2)}</span></div>` : ''}
          <div class="total-row"><span>Delivery Fee</span><span>R${deliveryFee.toFixed(2)}</span></div>
          <div class="total-row grand-total"><span>Total</span><span class="amount">R${total.toFixed(2)}</span></div>
        </div>

        <div class="order-expanded-actions">${actionsHtml}</div>
      </div>
    </article>
  `;
}

function renderOrderItem(item) {
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
      statusHtml = `<div class="item-status-badge alternate"><i class="fas fa-exchange-alt"></i> ${statusText}</div>`;
    } else if (isOutOfStock) {
      statusHtml = `<div class="item-status-badge out-of-stock"><i class="fas fa-times-circle"></i> ${statusText}</div>`;
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

function wireCardEvents() {
  document.querySelectorAll('.order-card').forEach(card => {
    const header = card.querySelector('.order-card-header');
    if (header) {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn') || e.target.closest('a')) return;
        card.classList.toggle('expanded');
      });
    }
  });

  document.querySelectorAll('.order-expanded-actions .action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const orderId = btn.dataset.orderid;
      const order = ordersMap.get(orderId);
      if (!order) return;

      if (action === 'whatsapp') sendReceipt('whatsapp', order, orderId);
      else if (action === 'email') sendReceipt('email', order, orderId);
      else if (action === 'reorder') reorderItems(order);
      else if (action === 'review') openReview(orderId);
    });
  });
}

// ============================================================
//  DRIVER PHOTOS — [REFACTOR]
//  Reads driverPhoto from the order itself. The full driver
//  document is no longer readable by customers.
// ============================================================
function fetchDriverPhotos() {
  document.querySelectorAll('.driver-section').forEach(section => {
    const orderId = section.dataset.orderId;
    const photoId = `driverPhoto_${orderId}`;
    const photoEl = document.getElementById(photoId);
    if (!photoEl) return;

    const order = ordersMap.get(orderId);
    const url = order && order.driverPhoto ? order.driverPhoto : '';
    if (url) {
      photoEl.innerHTML = `<img src="${escapeHtml(url)}" alt="" class="driver-profile-photo" onerror="this.style.display='none'" />`;
    } else {
      photoEl.textContent = '';
    }
  });
}

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

function reorderItems(order) {
  if (!order.items || !order.items.length) {
    showToast('No items to reorder.');
    return;
  }

  const cart = getCart();
  if (cart.length > 0 && cart[0].store !== order.store) {
    showToast('Please complete your current cart first.');
    return;
  }

  order.items.forEach(item => {
    const itemToAdd = (item.alternateAccepted && item.alternate) ? item.alternate : item;
    const existing = cart.find(c => c.id === itemToAdd.id && c.store === order.store);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      cart.push({
        id: itemToAdd.id,
        name: itemToAdd.name,
        store: order.store,
        storeId: order.storeId || '',
        price: itemToAdd.price,
        quantity: item.quantity,
        image: itemToAdd.image || 'img/placeholder.jpg',
        category: item.category || ''
      });
    }
  });

  saveCart(cart);
  showToast(`${order.items.length} items added to cart.`);
  setTimeout(() => { window.location.href = 'cart.html'; }, 900);
}

function initReviewModal() {
  if (!reviewModal) return;

  reviewModal.querySelectorAll('[data-review-close]').forEach(el => {
    el.addEventListener('click', closeReview);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && reviewModal.classList.contains('open')) {
      closeReview();
    }
  });

  document.addEventListener('click', (e) => {
    const star = e.target.closest('.stars i');
    if (!star) return;
    const stars = star.closest('.stars');
    const target = stars.dataset.target;
    const value = parseInt(star.dataset.value, 10);

    stars.querySelectorAll('i').forEach((s, idx) => {
      s.classList.toggle('active', idx < value);
      s.classList.toggle('far', idx >= value);
      s.classList.toggle('fas', idx < value);
    });

    const label = document.getElementById(target === 'store' ? 'storeRatingLabel' : 'driverRatingLabel');
    const labels = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
    if (label) label.textContent = labels[value] || 'Select rating';
  });

  if (reviewSubmitBtn) {
    reviewSubmitBtn.addEventListener('click', submitReview);
  }
}

function openReview(orderId) {
  reviewOrderId = orderId;
  if (!reviewModal) return;

  document.querySelectorAll('.stars i').forEach(s => {
    s.classList.remove('active');
    s.classList.add('far');
    s.classList.remove('fas');
  });
  const storeLbl = document.getElementById('storeRatingLabel');
  const driverLbl = document.getElementById('driverRatingLabel');
  if (storeLbl) storeLbl.textContent = 'Select rating';
  if (driverLbl) driverLbl.textContent = 'Select rating';
  if (reviewComment) reviewComment.value = '';

  reviewModal.hidden = false;
  requestAnimationFrame(() => reviewModal.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeReview() {
  if (!reviewModal) return;
  reviewModal.classList.remove('open');
  setTimeout(() => {
    reviewModal.hidden = true;
    document.body.style.overflow = '';
  }, 250);
  reviewOrderId = null;
}

async function submitReview() {
  if (!reviewOrderId || !currentUser) return;

  const storeStars = document.querySelectorAll('.stars[data-target="store"] i.active').length;
  const driverStars = document.querySelectorAll('.stars[data-target="driver"] i.active').length;
  const comment = (reviewComment?.value || '').trim();

  if (storeStars === 0 && driverStars === 0) {
    showToast('Please rate the store or driver.');
    return;
  }

  reviewSubmitBtn.disabled = true;
  reviewSubmitBtn.textContent = 'Submitting...';

  try {
    const orderDoc = await getDoc(doc(db, 'orders', reviewOrderId));
    if (!orderDoc.exists()) {
      showToast('Order not found.');
      return;
    }
    const order = orderDoc.data();

    await addDoc(collection(db, 'reviews'), {
      orderId: reviewOrderId,
      customerId: currentUser.uid,
      customerName: userData?.name || 'Anonymous',
      storeRating: storeStars,
      driverRating: driverStars,
      comment,
      storeName: order.store || '',
      driverId: order.driverId || null,
      createdAt: serverTimestamp()
    });

    if (storeStars > 0 && order.store) {
      await updateStoreRating(order.store, storeStars);
    }
    if (driverStars > 0 && order.driverId) {
      await updateDriverRating(order.driverId, driverStars);
    }

    await updateDoc(doc(db, 'orders', reviewOrderId), {
      hasReview: true,
      updatedAt: serverTimestamp()
    });

    showToast('Thank you for your review.');
    closeReview();

  } catch (err) {
    console.error('Error submitting review:', err);
    showToast('Could not submit review. Please try again.');
  } finally {
    reviewSubmitBtn.disabled = false;
    reviewSubmitBtn.textContent = 'Submit Review';
  }
}

async function updateStoreRating(storeName, newRating) {
  try {
    const snap = await getDocs(query(collection(db, 'stores'), where('name', '==', storeName)));
    if (snap.empty) return;
    const storeDoc = snap.docs[0];
    const data = storeDoc.data();
    const current = Number(data.rating || 0);
    const count = Number(data.reviewCount || 0);
    const avg = ((current * count) + newRating) / (count + 1);
    await updateDoc(doc(db, 'stores', storeDoc.id), {
      rating: Math.round(avg * 10) / 10,
      reviewCount: count + 1,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not update store rating:', err);
  }
}

async function updateDriverRating(driverId, newRating) {
  try {
    const ref = doc(db, 'drivers', driverId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const current = Number(data.rating || 0);
    const count = Number(data.reviewCount || 0);
    const avg = ((current * count) + newRating) / (count + 1);
    await updateDoc(ref, {
      rating: Math.round(avg * 10) / 10,
      reviewCount: count + 1,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not update driver rating:', err);
  }
}

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