// js/store-accept.js
//
// REFACTORED:
//  - The refund for out-of-stock items is now issued server-side
//    inside storeAcceptOrder, atomically with the order update.
//    The client no longer calls processRefund after acceptance.
//  - itemsData is now always the FULL length of order.items so
//    the server's length check passes.
//  - The removed `processRefund` function is deleted.
//
// Firebase config – uses window.__ENV if available, otherwise fallback
const firebaseConfig = window.__ENV?.FIREBASE || {
  apiKey: "AIzaSyBnYQqVzQTdbhjd2bXKKqvKkSIc4XGpwSw",
  authDomain: "ghostshopza.firebaseapp.com",
  projectId: "ghostshopza",
  storageBucket: "ghostshopza.firebasestorage.app",
  messagingSenderId: "473222699760",
  appId: "1:473222699760:web:3c0f791cd90cd823868035"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const functions = firebase.functions();

// ===== DOM refs =====
const content = document.getElementById('content');
const orderIdDisplay = document.getElementById('orderIdDisplay');

// Get orderId and token from URL
const urlParams = new URLSearchParams(window.location.search);
const orderId = urlParams.get('orderId');
const token = urlParams.get('token');

if (!orderId || !token) {
  content.innerHTML = `<div class="status-msg error">Invalid link. Please contact support.</div>`;
  throw new Error('Missing orderId or token');
}

orderIdDisplay.textContent = `Order #${orderId.slice(-6).toUpperCase()}`;

// ===== Load order (realtime) =====
const orderRef = db.collection('orders').doc(orderId);
let orderData = null;

orderRef.onSnapshot((snap) => {
  if (!snap.exists) {
    content.innerHTML = `<div class="status-msg error">Order not found.</div>`;
    return;
  }
  orderData = snap.data();
  renderOrder(orderData);
}, (error) => {
  content.innerHTML = `<div class="status-msg error">Error loading order: ${error.message}</div>`;
});

// ===== Render =====
function renderOrder(order) {
  if (order.storeAcceptToken !== token) {
    content.innerHTML = `<div class="status-msg error">Invalid token. Please use the link from WhatsApp.</div>`;
    return;
  }

  if (order.orderStatus === 'delivered' || order.orderStatus === 'cancelled') {
    content.innerHTML = `
      <div class="status-msg success">This order is already ${order.orderStatus}.</div>
      ${order.driverName ? `<div class="driver-info"><i class="fas fa-motorcycle"></i> Driver: ${order.driverName}</div>` : ''}
    `;
    return;
  }

  if (order.driverId && order.orderStatus !== 'delivered') {
    content.innerHTML = `
      <div class="status-msg success">✅ Order has been assigned to a driver.</div>
      <div class="driver-info"><i class="fas fa-motorcycle"></i> Driver: ${order.driverName || 'Driver'} is on the way.</div>
      <div style="text-align:center;margin-top:1rem;font-size:0.9rem;color:var(--text-secondary);">Contact Ghost Shopper if you need assistance.</div>
    `;
    return;
  }

  if (order.storeReady === true) {
    content.innerHTML = `
      <div class="status-msg success">✅ Order marked as ready for collection.</div>
      ${order.driverId ? `<div class="driver-info"><i class="fas fa-motorcycle"></i> Driver: ${order.driverName || 'Driver'}</div>` : '<div class="status-msg" style="background:#FFF7ED;color:var(--orange);">⏳ Waiting for a driver to accept the order.</div>'}
    `;
    return;
  }

  let warningBanner = `
    <div class="warning-banner">
      <i class="fas fa-exclamation-triangle"></i>
      <span>Please confirm items carefully. Changes cannot be made after processing.</span>
    </div>
  `;

  const items = order.items || [];
  const refundedIndexes = Array.isArray(order.refundedItemIndexes) ? order.refundedItemIndexes : [];
  let html = warningBanner;
  html += `<div class="items-section-title">Items</div>`;

  const isPacking = order.storeAccepted === true || order.orderStatus === 'packing';

  items.forEach((item, idx) => {
    const hasAlternate = item.alternate && item.alternate.id;
    const isAccepted = item.accepted === true;
    const isAlternateAccepted = item.alternateAccepted === true;
    const isOutOfStock = item.isOutOfStock === true;
    const wasAlreadyRefunded = refundedIndexes.includes(idx);

    let displayStatus = 'in-stock';
    let statusLabel = '✅ In Stock';
    let displayItem = item;
    let isGreyedOut = false;

    if (wasAlreadyRefunded) {
      displayStatus = 'refunded';
      statusLabel = '💰 Refunded';
      isGreyedOut = true;
    } else if (isOutOfStock || (isPacking && !isAccepted && !isAlternateAccepted)) {
      displayStatus = 'out-of-stock';
      statusLabel = '❌ Out of Stock';
      isGreyedOut = true;
    } else if (isAlternateAccepted && hasAlternate) {
      displayStatus = 'alternate';
      statusLabel = '🔄 Alternate Selected';
      displayItem = { ...item.alternate, quantity: item.quantity };
    } else if (isAccepted) {
      displayStatus = 'in-stock';
      statusLabel = '✅ In Stock';
    } else if (!isAccepted && !isAlternateAccepted && hasAlternate) {
      displayStatus = 'pending';
      statusLabel = '⏳ Pending';
    }

    const imgSrc = displayItem.image || 'img/placeholder.jpg';
    const itemName = displayItem.name || 'Unknown Item';
    const price = displayItem.price || 0;
    const qty = displayItem.quantity || 1;

    let rowHtml = `
      <div class="item-row ${isGreyedOut ? 'greyed-out' : ''}" data-index="${idx}">
        <div class="item-main">
          <input type="checkbox" class="item-check main-check" data-index="${idx}" ${isAccepted ? 'checked' : ''} ${isGreyedOut ? 'disabled' : ''} />
          <div class="item-info">
            <div class="item-header">
              <img src="${imgSrc}" alt="${itemName}" class="item-img" onerror="this.src='img/placeholder.jpg'" />
              <div class="item-details">
                <div class="item-name">${itemName}</div>
                <div class="item-price">R${price.toFixed(2)} × ${qty}</div>
                <div class="item-status-badge ${displayStatus}">${statusLabel}</div>
              </div>
            </div>
          </div>
        </div>
    `;

    if (hasAlternate && !isGreyedOut) {
      const altChecked = isAlternateAccepted ? 'checked' : '';
      rowHtml += `
        <div class="alternate-section" id="altSection_${idx}">
          <div class="alternate-option">
            <input type="checkbox" class="item-check alt-check" data-index="${idx}" id="altCheck_${idx}" ${altChecked} />
            <label for="altCheck_${idx}" class="alt-label">
              <img src="${item.alternate.image || 'img/placeholder.jpg'}" alt="${item.alternate.name}" class="alt-img" onerror="this.src='img/placeholder.jpg'" />
              <span class="alt-name">${item.alternate.name}</span>
              <span class="alt-price">R${item.alternate.price ? item.alternate.price.toFixed(2) : '0.00'}</span>
            </label>
          </div>
        </div>
      `;
    }

    if (!isGreyedOut) {
      rowHtml += `
        <div class="out-of-stock-section" id="oosSection_${idx}">
          <label class="oos-label">
            <input type="radio" name="stock_${idx}" value="oos" class="oos-radio" data-index="${idx}" ${isOutOfStock ? 'checked' : ''} />
            <span class="oos-text"><i class="fas fa-times-circle"></i> Out of Stock</span>
          </label>
        </div>
      `;
    }

    rowHtml += `</div>`;
    html += rowHtml;
  });

  if (isPacking) {
    html += `<button class="btn-ready" id="readyBtn">✅ Mark as Ready for Collection</button>`;
  } else {
    html += `<button class="btn-accept" id="acceptBtn">📦 Confirm Stock &amp; Start Packing</button>`;
  }

  content.innerHTML = html;

  if (!isPacking) {
    setupInitialListeners();
    document.getElementById('acceptBtn')?.addEventListener('click', () => {
      if (confirm('Are you sure you have checked all items? Changes cannot be undone.')) {
        submitAcceptance(false);
      }
    });
  } else {
    document.getElementById('readyBtn')?.addEventListener('click', () => {
      if (confirm('Mark this order as ready for collection? The order will be assigned to a driver.')) {
        submitAcceptance(true);
      }
    });
  }
}

// ===== Setup initial listeners (acceptance mode) =====
function setupInitialListeners() {
  document.querySelectorAll('.main-check').forEach(cb => {
    cb.addEventListener('change', function() {
      const idx = parseInt(this.dataset.index);
      const altCheck = document.getElementById(`altCheck_${idx}`);
      const oosRadio = document.querySelector(`.oos-radio[data-index="${idx}"]`);

      if (this.checked) {
        if (altCheck) altCheck.checked = false;
        if (oosRadio) oosRadio.checked = false;
        document.querySelector(`.item-row[data-index="${idx}"]`).classList.remove('greyed-out');
      } else {
        document.querySelector(`.item-row[data-index="${idx}"]`).classList.add('greyed-out');
      }
    });
  });

  document.querySelectorAll('.alt-check').forEach(cb => {
    cb.addEventListener('change', function() {
      const idx = parseInt(this.dataset.index);
      const mainCheck = document.querySelector(`.main-check[data-index="${idx}"]`);
      const oosRadio = document.querySelector(`.oos-radio[data-index="${idx}"]`);

      if (this.checked) {
        if (mainCheck) mainCheck.checked = false;
        if (oosRadio) oosRadio.checked = false;
        document.querySelector(`.item-row[data-index="${idx}"]`).classList.add('greyed-out');
      } else {
        document.querySelector(`.item-row[data-index="${idx}"]`).classList.remove('greyed-out');
      }
    });
  });

  document.querySelectorAll('.oos-radio').forEach(radio => {
    radio.addEventListener('change', function() {
      const idx = parseInt(this.dataset.index);
      const mainCheck = document.querySelector(`.main-check[data-index="${idx}"]`);
      const altCheck = document.getElementById(`altCheck_${idx}`);

      if (this.checked) {
        if (mainCheck) mainCheck.checked = false;
        if (altCheck) altCheck.checked = false;
        document.querySelector(`.item-row[data-index="${idx}"]`).classList.add('greyed-out');
      } else {
        document.querySelector(`.item-row[data-index="${idx}"]`).classList.remove('greyed-out');
      }
    });
  });
}

// ===== Submit acceptance =====
async function submitAcceptance(ready = false) {
  const items = orderData?.items || [];

  // Build a full-length array matching order.items. Any index that was
  // previously refunded keeps its prior state and is re-sent unchanged.
  const refundedIndexes = Array.isArray(orderData?.refundedItemIndexes)
    ? orderData.refundedItemIndexes
    : [];

  const itemsData = items.map((item, idx) => {
    if (refundedIndexes.includes(idx)) {
      // Already refunded — resend as-is.
      return {
        accepted: item.accepted === true,
        alternateAccepted: item.alternateAccepted === true,
        alternate: item.alternate || null,
        isOutOfStock: item.isOutOfStock === true
      };
    }

    if (ready) {
      // In ready mode the store cannot change anything; resend server state.
      return {
        accepted: item.accepted === true,
        alternateAccepted: item.alternateAccepted === true,
        alternate: item.alternate || null,
        isOutOfStock: item.isOutOfStock === true
      };
    }

    // Acceptance mode: read current UI state for this index.
    const mainCheck = document.querySelector(`.main-check[data-index="${idx}"]`);
    const altCheck = document.getElementById(`altCheck_${idx}`);
    const oosRadio = document.querySelector(`.oos-radio[data-index="${idx}"]`);

    let accepted = mainCheck ? mainCheck.checked : false;
    let alternateAccepted = altCheck ? altCheck.checked : false;
    let isOutOfStock = oosRadio ? oosRadio.checked : false;

    if (isOutOfStock) {
      accepted = false;
      alternateAccepted = false;
    }

    return {
      accepted,
      alternateAccepted,
      alternate: item.alternate || null,
      isOutOfStock
    };
  });

  const submitBtn = document.getElementById('acceptBtn') || document.getElementById('readyBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  }

  try {
    const storeAccept = functions.httpsCallable('storeAcceptOrder');
    const result = await storeAccept({
      orderId,
      token,
      items: itemsData,
      ready
    });

    if (result.data.success) {
      const status = result.data.status;
      const refunded = Number(result.data.refunded || 0);
      let msg = ready ? '✅ Order marked as ready for collection!' : '✅ Order accepted! Packing now.';
      if (refunded > 0) {
        msg += ` R${refunded.toFixed(2)} refunded to customer wallet.`;
      }
      showStatus(msg, 'success');

      // No client-side processRefund call. The server did it.
      if (ready) {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '✅ Ready for Collection';
        }
      } else {
        setTimeout(() => {
          orderRef.get().then(snap => {
            if (snap.exists) {
              orderData = snap.data();
              renderOrder(orderData);
            }
          });
        }, 1000);
      }
    }
  } catch (error) {
    console.error(error);
    showStatus('❌ Error: ' + (error.message || 'Unknown error'), 'error');
  }

  if (submitBtn && !submitBtn.disabled) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = ready ? '✅ Mark as Ready for Collection' : '📦 Confirm Stock & Start Packing';
  }
}

function showStatus(msg, type) {
  const existing = document.querySelector('.status-msg');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `status-msg ${type}`;
  div.textContent = msg;
  const c = document.getElementById('content');
  if (c) c.prepend(div);
}