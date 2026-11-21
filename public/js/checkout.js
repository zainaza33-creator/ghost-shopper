// ================================================================
//  checkout.js — Ghost Shopper Checkout
//  Refactored to use the new Delivery Pricing Engine.
// ================================================================

console.log('🚀 checkout.js booting...');

import { auth, db, functions, httpsCallable } from './firebase-config.js';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  arrayUnion,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  showToast,
  updateCartBadge,
  getCart,
  initGlobal,
  openAuthModal,
  updateNotificationBadge
} from './global.js';

// ===== Constants =====
const CART_KEY = 'ghostShopperCart';
const PACKAGING_PRICE = 2.00;
const ITEMS_PER_PACKAGING = 4;

const LEAD_TIME_MINUTES = 60;
const SLOT_LENGTH_MINUTES = 60;
const MAX_DAYS_AHEAD = 14;

// ===== DOM =====
const loadingScreen = document.getElementById('loadingScreen');
const addressBody   = document.getElementById('addressBody');
const timeBody      = document.getElementById('timeBody');
const paymentBody   = document.getElementById('paymentBody');

const sectionAddressCheck = document.getElementById('sectionAddressCheck');
const sectionTimeCheck    = document.getElementById('sectionTimeCheck');

const cloudskunkModal    = document.getElementById('cloudskunkModal');
const cloudskunkInfoLink = document.getElementById('cloudskunkInfoLink');

// ===== State =====
let currentUser = null;
let userData = null;
let userAddresses = [];
let walletBalance = 0;

let isLoggedIn = false;
let authResolved = false;

let selectedAddress = null;
let selectedLatLng = null;
let selectedTimeSlot = null;
let selectedTimeSlotDisplay = null;
let addressConfirmed = false;
let isDeliverable = false;
let addressStatusMessage = '';
let calculatedDeliveryFee = 0;
let isCalculatingFee = false;

let deliveryAreas = [];
let storeData = null;
let storeHours = null;
let storeSessions = [];      // index 0..6 (Sun..Sat)
let storeOverrides = [];     // [{date:'YYYY-MM-DD', sessions:[{open,close}]}, ...]
let storeLoaded = false;
let addressStepRendered = false;

let map = null;
let marker = null;
let autocomplete = null;
let mapInitialized = false;

let cartItems = [];
let paymentMethod = 'yoco';
let isProcessingPayment = false;

let allSlots = [];
let showAllSlots = false;

// ================================================================
//  BOOTSTRAP
// ================================================================
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

  cartItems = getCart();
  if (cartItems.length === 0) {
    showToast('Your cart is empty. Redirecting to cart...');
    setTimeout(() => { window.location.href = 'cart.html'; }, 1500);
    return;
  }

  loadDeliveryAreas();
  initCloudskunkModal();
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
}

// ================================================================
//  DELIVERY AREAS (used only as a high-level "do we serve this area" gate now)
// ================================================================
async function loadDeliveryAreas() {
  try {
    const snap = await getDocs(collection(db, 'areas'));
    deliveryAreas = [];
    snap.forEach(d => {
      const area = d.data();
      if (area.active !== false) deliveryAreas.push({ id: d.id, ...area });
    });
  } catch (err) {
    console.warn('Could not load delivery areas:', err);
    deliveryAreas = [];
  }
}

// ================================================================
//  AUTH STATE
// ================================================================
auth.onAuthStateChanged(async (user) => {
  authResolved = true;
  if (loadingScreen) loadingScreen.classList.add('hidden');

  if (user) {
    currentUser = user;
    isLoggedIn = true;

    try {
      const userRef = doc(db, 'users', user.uid);
      onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          userData = { id: snap.id, ...snap.data() };
          userAddresses = userData.savedAddresses || [];
          walletBalance = userData.walletBalance || 0;
          if (addressStepRendered) renderAddressSection();
          renderPaymentSection();
        }
      });

      const snap = await getDoc(userRef);
      if (snap.exists()) {
        userData = { id: snap.id, ...snap.data() };
        userAddresses = userData.savedAddresses || [];
        walletBalance = userData.walletBalance || 0;
      } else {
        await setDoc(userRef, {
          name: '',
          phone: user.phoneNumber || '',
          email: '',
          role: 'customer',
          createdAt: new Date(),
          savedAddresses: [],
          walletBalance: 0
        });
        userData = { name: '', phone: user.phoneNumber || '', email: '', role: 'customer', savedAddresses: [], walletBalance: 0 };
        userAddresses = [];
        walletBalance = 0;
      }

      renderAddressSection();
      renderTimeSection();
      renderPaymentSection();
      updateStoreBadge();

    } catch (err) {
      console.error('Error loading user data:', err);
      showToast('Error loading account. Please refresh.');
    }
  } else {
    isLoggedIn = false;
    currentUser = null;
    userData = null;

    renderAddressSection();
    renderTimeSection();
    renderPaymentSection();
    updateStoreBadge();

    setTimeout(() => {
      try { openAuthModal(); } catch (err) { console.warn(err); }
    }, 400);

    const startedAt = Date.now();
    const check = setInterval(() => {
      if (auth.currentUser) { clearInterval(check); return; }
      const authModal = document.getElementById('authModal');
      const modalClosed = !authModal || authModal.style.display !== 'flex';
      if (modalClosed && Date.now() - startedAt > 2000) {
        clearInterval(check);
        showToast('Sign in required. Returning to cart.');
        setTimeout(() => { window.location.href = 'cart.html'; }, 1200);
      }
    }, 800);
  }
});

// ================================================================
//  STORE BADGE
// ================================================================
function updateStoreBadge() {
  const badge = document.getElementById('checkoutStoreBadge');
  const nameEl = document.getElementById('checkoutStoreName');
  const cart = getCart();
  if (cart.length > 0 && cart[0].store) {
    if (badge) badge.hidden = false;
    if (nameEl) nameEl.textContent = cart[0].store;
    loadStoreData(cart[0].store, cart[0].storeId);
  } else {
    if (badge) badge.hidden = true;
  }
}

async function loadStoreData(storeName, storeId) {
  try {
    let store = null;
    if (storeId) {
      const docSnap = await getDoc(doc(db, 'stores', storeId));
      if (docSnap.exists()) store = docSnap.data();
    } else {
      const snap = await getDocs(query(collection(db, 'stores'), where('name', '==', storeName)));
      if (!snap.empty) store = snap.docs[0].data();
    }

    storeData = store || {};

    if (storeData.openingHours && typeof storeData.openingHours === 'object') {
      storeSessions = buildSessionsFromOpeningHours(storeData.openingHours);
    } else {
      storeHours = storeData.hours || 'Mon-Sat 8am-6pm';
      storeSessions = buildSessionsFromLegacy(parseStoreHours(storeHours));
    }

    storeOverrides = Array.isArray(storeData.hoursOverrides) ? storeData.hoursOverrides : [];
    storeLoaded = true;

    if (addressStepRendered) {
      generateTimeSlots();
      renderTimeSection();
    }
  } catch (err) {
    console.warn('Could not load store data:', err);
    const fallback = [];
    for (let d = 0; d < 7; d++) {
      fallback.push(d === 0 ? [] : [{ open: 8 * 60, close: 18 * 60 }]);
    }
    storeSessions = fallback;
    storeOverrides = [];
    storeLoaded = true;
    if (addressStepRendered) {
      generateTimeSlots();
      renderTimeSection();
    }
  }
}

function buildSessionsFromOpeningHours(openingHours) {
  const out = [[], [], [], [], [], [], []];
  const keyMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  Object.keys(keyMap).forEach(k => {
    const idx = keyMap[k];
    const day = openingHours[k];
    const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
    out[idx] = sessions
      .map(s => {
        const open = parseHHMM(s?.open);
        const close = parseHHMM(s?.close);
        if (open == null || close == null || open >= close) return null;
        return { open, close };
      })
      .filter(Boolean);
  });

  return out;
}

function buildSessionsFromLegacy(legacyDays) {
  const out = [[], [], [], [], [], [], []];
  legacyDays.forEach(d => {
    if (!d || d.closed) return;
    if (typeof d.open === 'number' && typeof d.close === 'number' && d.open < d.close) {
      out[d.day].push({ open: d.open, close: d.close });
    }
  });
  return out;
}

function parseHHMM(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;

  const s = String(v).trim().toLowerCase();
  if (!s) return null;

  let body = s;
  let period = '';

  const m = body.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;

  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  period = m[3] || '';
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

// ================================================================
//  SECTION 1 — ADDRESS
// ================================================================
function renderAddressSection() {
  if (!addressBody) return;
  addressStepRendered = true;

  const savedChips = (isLoggedIn && userAddresses.length > 0)
    ? `
      <div class="saved-addresses-block">
        <label class="saved-addresses-label">
          <i class="fas fa-bookmark" aria-hidden="true"></i>
          Saved addresses
        </label>
        <div class="saved-address-chips">
          ${userAddresses.map((addr, i) => {
            const label = addr.label || '';
            const labelIcon = label === 'home'
              ? 'fas fa-home'
              : label === 'work'
                ? 'fas fa-briefcase'
                : 'fas fa-map-pin';
            const prefix = label
              ? `<span class="address-chip-label">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</span>`
              : '';
            return `
              <button type="button" class="address-chip" data-index="${i}">
                <i class="${labelIcon}" aria-hidden="true"></i>
                <span class="address-chip-text">
                  ${prefix}
                  <span class="address-chip-street">${escapeHtml(addr.street || '')}</span>
                </span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    ` : '';

  addressBody.innerHTML = `
    ${savedChips}

    <label for="addressInput" class="address-search-label">
      <i class="fas fa-map-pin" aria-hidden="true"></i>
      Search for your address
    </label>

    <div class="address-input-wrapper">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input
        type="text"
        id="addressInput"
        placeholder="Start typing your address…"
        autocomplete="off"
      />
      <button class="address-use-location-btn" id="useLocationBtn" type="button" aria-label="Use my current location">
        <i class="fas fa-location-crosshairs" aria-hidden="true"></i>
      </button>
    </div>

    <p class="address-hint">
      <i class="fas fa-info-circle" aria-hidden="true"></i>
      We only deliver to certain areas. We'll let you know if we reach yours.
    </p>

    <div class="map-container" id="mapContainer">
      <div id="map"></div>
    </div>

    <div class="selected-address" id="selectedAddress" hidden>
      <i class="fas fa-map-pin" aria-hidden="true"></i>
      <div class="selected-address-text">
        <span class="selected-address-label">Delivering to</span>
        <span id="addressDisplay">—</span>
      </div>
    </div>

    <div class="delivery-status" id="deliveryStatus" hidden></div>
  `;

  wireAddressSection();
  renderTimeSection();
  renderPaymentSection();

  if (!mapInitialized && window.google && window.google.maps) {
    try { initCheckoutMap(); } catch (e) { console.warn(e); }
  } else if (!mapInitialized) {
    setTimeout(() => {
      if (!mapInitialized && window.google && window.google.maps) {
        try { initCheckoutMap(); } catch (e) { console.warn(e); }
      }
    }, 1500);
  }

  if (storeLoaded) {
    generateTimeSlots();
    renderTimeSection();
  }
}

function wireAddressSection() {
  const input = document.getElementById('addressInput');
  const display = document.getElementById('addressDisplay');
  const box = document.getElementById('selectedAddress');
  const useBtn = document.getElementById('useLocationBtn');

  if (input) {
    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (val) {
        selectedAddress = val;
        if (display) display.textContent = val;
        if (box) box.hidden = false;
        checkDeliverable(val);
        updateDeliveryStatus();
        updateSectionChecks();
      } else {
        selectedAddress = null;
        selectedLatLng = null;
        if (display) display.textContent = '—';
        if (box) box.hidden = true;
        isDeliverable = false;
        updateDeliveryStatus();
        updateSectionChecks();
      }
      renderTimeSection();
      renderPaymentSection();
    });
  }

  if (useBtn) useBtn.addEventListener('click', useCurrentLocation);

  document.querySelectorAll('.address-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.index, 10);
      const addr = userAddresses[idx];
      if (!addr) return;
      selectedAddress = addr.street;
      selectedLatLng = { lat: addr.lat, lng: addr.lng };
      if (input) input.value = selectedAddress;
      if (display) display.textContent = selectedAddress;
      if (box) box.hidden = false;
      checkDeliverable(selectedAddress);
      updateDeliveryStatus();
      if (map && marker) {
        const pos = { lat: addr.lat, lng: addr.lng };
        map.setCenter(pos);
        marker.setPosition(pos);
        map.setZoom(16);
      }
      document.querySelectorAll('.address-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updateSectionChecks();
      renderTimeSection();
      renderPaymentSection();
      showToast('Address loaded.');
    });
  });
}

// ================================================================
//  SECTION 2 — TIME
// ================================================================
function renderTimeSection() {
  if (!timeBody) return;

  if (!selectedAddress) {
    timeBody.innerHTML = `
      <div class="time-locked-hint">
        <i class="fas fa-lock" aria-hidden="true"></i>
        <span>Enter your address above to see available delivery times.</span>
      </div>
    `;
    return;
  }

  if (!isDeliverable) {
    timeBody.innerHTML = `
      <div class="time-locked-hint">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        <span>We don't deliver to this address yet. Try a different address, or request delivery above.</span>
      </div>
    `;
    return;
  }

  if (!allSlots.length) {
    timeBody.innerHTML = `
      <div class="time-empty">
        <i class="fas fa-clock" aria-hidden="true"></i>
        <p>No delivery slots available right now. Please check back later.</p>
      </div>
    `;
    return;
  }

  const visibleCount = showAllSlots ? allSlots.length : Math.min(4, allSlots.length);
  const visible = allSlots.slice(0, visibleCount);
  const hasMore = allSlots.length > 4;

  const first = allSlots[0];
  const nextLabel = first.isToday ? 'Today' : first.isTomorrow ? 'Tomorrow' : escapeHtml(first.dayName);
  const nextLine = `
    <div class="time-next-available">
      <i class="fas fa-clock" aria-hidden="true"></i>
      <span>Next available: <strong>${nextLabel}</strong> · ${escapeHtml(first.timeRange)}</span>
    </div>
  `;

  const cardsHtml = visible.map(s => `
    <button type="button"
            class="time-slot-card ${selectedTimeSlot === s.value ? 'selected' : ''}"
            data-value="${escapeHtml(s.value)}">
      <span class="time-slot-day">${escapeHtml(s.dayLabel)}</span>
      <span class="time-slot-time">${escapeHtml(s.timeRange)}</span>
    </button>
  `).join('');

  const moreBtn = hasMore
    ? `<button type="button" class="time-more-btn" id="timeMoreBtn">
         ${showAllSlots
           ? '<i class="fas fa-chevron-up" aria-hidden="true"></i> Show fewer times'
           : `<i class="fas fa-chevron-down" aria-hidden="true"></i> More times (${allSlots.length - 4} more)`}
       </button>`
    : '';

  timeBody.innerHTML = `
    ${nextLine}
    <div class="time-slots-grid">${cardsHtml}</div>
    ${moreBtn}
  `;

  timeBody.querySelectorAll('.time-slot-card').forEach(card => {
    card.addEventListener('click', () => {
      const value = card.dataset.value;
      const slot = allSlots.find(s => s.value === value);
      if (!slot) return;
      selectedTimeSlot = slot.value;
      selectedTimeSlotDisplay = slot.display;
      timeBody.querySelectorAll('.time-slot-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updateSectionChecks();
      renderPaymentSection();
    });
  });

  const moreBtnEl = document.getElementById('timeMoreBtn');
  if (moreBtnEl) {
    moreBtnEl.addEventListener('click', () => {
      showAllSlots = !showAllSlots;
      renderTimeSection();
    });
  }
}

// ================================================================
//  SECTION CHECKS
// ================================================================
function updateSectionChecks() {
  const addressReady = !!selectedAddress && isDeliverable;

  if (sectionAddressCheck) sectionAddressCheck.hidden = !addressReady;
  if (sectionTimeCheck) sectionTimeCheck.hidden = !selectedTimeSlot;

  const sectionAddress = document.getElementById('sectionAddress');
  const sectionTime = document.getElementById('sectionTime');
  if (sectionAddress) sectionAddress.classList.toggle('completed', addressReady);
  if (sectionTime) sectionTime.classList.toggle('completed', !!selectedTimeSlot);

  if (addressReady && selectedTimeSlot && !addressConfirmed && isLoggedIn) {
    addressConfirmed = true;
    // We REMOVED saveAddressToUser() from here so it doesn't save yet.
    renderPaymentSection();
    showToast('Address and time confirmed.');
  }
}

async function saveAddressToUser() {
  if (!currentUser || !selectedAddress || !selectedLatLng) return;
  try {
    const exists = userAddresses.some(a => a.street === selectedAddress);
    if (exists) return;
    const addressData = {
      street: selectedAddress,
      lat: selectedLatLng.lat,
      lng: selectedLatLng.lng,
      savedAt: new Date().toISOString(),
      isDefault: userAddresses.length === 0
    };
    await updateDoc(doc(db, 'users', currentUser.uid), {
      savedAddresses: arrayUnion(addressData)
    });
    userAddresses.push(addressData);
  } catch (err) {
    console.warn('Could not save address:', err);
  }
}

// ================================================================
//  DELIVERABILITY (CALCULATE FEE)
// ================================================================
async function checkDeliverable(address) {
  // Reset the confirmation so the UI updates when the fee changes
  addressConfirmed = false;

  if (!address || address.trim().length < 4) {
    isDeliverable = false;
    addressStatusMessage = '';
    calculatedDeliveryFee = 0;
    renderTimeSection(); // <--- ADDED
    renderPaymentSection(); 
    return false;
  }

  if (!deliveryAreas.length) {
    isDeliverable = false;
    addressStatusMessage = 'No delivery areas configured. Please contact support.';
    calculatedDeliveryFee = 0;
    renderTimeSection(); // <--- ADDED
    renderPaymentSection();
    return false;
  }

  const normalised = ' ' + String(address).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ') + ' ';

  let matchedAreaName = '';
  for (const area of deliveryAreas) {
    if (!area || area.active === false) continue;
    const name = String(area.name || '').trim().toLowerCase();
    if (!name) continue;
    const pattern = ' ' + name.replace(/\s+/g, ' ') + ' ';
    if (normalised.includes(pattern)) {
      matchedAreaName = capitaliseArea(area.name);
      break;
    }
  }

  if (!matchedAreaName) {
    isDeliverable = false;
    calculatedDeliveryFee = 0;
    addressStatusMessage = "We don't deliver to this area yet.";
    renderTimeSection(); // <--- ADDED
    renderPaymentSection();
    return false;
  }

  if (!selectedLatLng || !selectedLatLng.lat) {
    isDeliverable = false;
    calculatedDeliveryFee = 0;
    addressStatusMessage = "Please select a valid address from the dropdown to calculate delivery.";
    renderTimeSection(); // <--- ADDED
    renderPaymentSection();
    return false;
  }

  // Call the server to calculate distance
  isCalculatingFee = true;
  updateDeliveryStatus(); // show spinner
  try {
    const cart = getCart();
    const storeId = cart[0]?.storeId;
    if (!storeId) throw new Error("No store found");

    const calculateFn = httpsCallable(functions, 'calculateDeliveryFee');
    const res = await calculateFn({
      storeId,
      customerAddress: address,
      customerLat: selectedLatLng.lat,
      customerLng: selectedLatLng.lng
    });

    if (res.data && res.data.fee !== undefined) {
      isDeliverable = true;
      calculatedDeliveryFee = res.data.fee;
      if (res.data.isOverride) {
        addressStatusMessage = `Special delivery rate applied for ${matchedAreaName}. Fee: R${calculatedDeliveryFee.toFixed(2)}`;
      } else {
        addressStatusMessage = `Delivering to ${matchedAreaName} (${res.data.distanceKm} km). Fee: R${calculatedDeliveryFee.toFixed(2)}`;
      }
      
      // THIS IS THE CRITICAL FIX: We must re-render the time section now that isDeliverable is true
      renderTimeSection(); 
      renderPaymentSection(); 
      return true;
    }
  } catch (err) {
    console.error('calculateDeliveryFee error:', err);
    isDeliverable = false;
    calculatedDeliveryFee = 0;
    addressStatusMessage = err.message || "Could not calculate delivery distance.";
    renderTimeSection(); // <--- ADDED
    renderPaymentSection();
    return false;
  } finally {
    isCalculatingFee = false;
    updateDeliveryStatus();
  }

  return false;
}

function capitaliseArea(name) {
  if (!name) return '';
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function updateDeliveryStatus() {
  const el = document.getElementById('deliveryStatus');
  if (!el) return;

  const address = (selectedAddress || '').trim();

  if (!address || address.length < 4) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  el.hidden = false;

  if (isCalculatingFee) {
    el.innerHTML = `
      <div class="delivery-status-badge deliverable" style="background:#f0f9ff; color:#0369a1;">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span>Calculating delivery fee...</span>
      </div>
    `;
    return;
  }

  if (isDeliverable) {
    el.innerHTML = `
      <div class="delivery-status-badge deliverable">
        <i class="fas fa-check-circle" aria-hidden="true"></i>
        <span>${escapeHtml(addressStatusMessage || '')}</span>
      </div>
    `;
    return;
  }

  const waMessage = `Hi Ghost Shopper, I'd like to request deliveries in my area. My address is: ${address}`;
  const waLink = `https://wa.me/27628989813?text=${encodeURIComponent(waMessage)}`;

  el.innerHTML = `
    <div class="delivery-request-card">
      <div class="delivery-request-icon">
        <i class="fas fa-map-location-dot" aria-hidden="true"></i>
      </div>
      <div class="delivery-request-text">
        <div class="delivery-request-title">We couldn't calculate delivery for this address</div>
        <div class="delivery-request-sub">
          Send us a message with your address and we'll assist you manually.
        </div>
      </div>
      <a class="delivery-request-btn" href="${waLink}" target="_blank" rel="noopener noreferrer">
        <i class="fab fa-whatsapp" aria-hidden="true"></i>
        <span>WhatsApp Us</span>
      </a>
    </div>
  `;
}

// ================================================================
//  GEOLOCATION
// ================================================================
function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  showToast('Getting your location...');
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const latLng = { lat: latitude, lng: longitude };
      try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: latLng }, (results, status) => {
          if (status === 'OK' && results[0]) {
            const address = results[0].formatted_address;
            selectedAddress = address;
            selectedLatLng = latLng;
            const input = document.getElementById('addressInput');
            const display = document.getElementById('addressDisplay');
            const box = document.getElementById('selectedAddress');
            if (input) input.value = address;
            if (display) display.textContent = address;
            if (box) box.hidden = false;
            checkDeliverable(address);
            updateDeliveryStatus();
            if (map && marker) {
              map.setCenter(latLng);
              marker.setPosition(latLng);
              map.setZoom(16);
            }
            updateSectionChecks();
            renderTimeSection();
            renderPaymentSection();
            showToast('Location detected.');
          }
        });
      } catch (err) {
        console.error(err);
        showToast('Could not get address from location.');
      }
    },
    (err) => {
      console.error(err);
      showToast('Could not get your location. Enter address manually.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ================================================================
//  MAP
// ================================================================
window.initCheckoutMap = function () {
  if (mapInitialized) return;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  try {
    mapInitialized = true;
    const defaultLocation = { lat: -29.6471, lng: 31.0522 };

    map = new google.maps.Map(mapEl, {
      center: defaultLocation,
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true
    });

    marker = new google.maps.Marker({
      position: defaultLocation,
      map,
      draggable: true,
      animation: google.maps.Animation.DROP
    });

    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      selectedLatLng = { lat: pos.lat(), lng: pos.lng() };
      reverseGeocode(pos.lat(), pos.lng());
    });

    map.addListener('click', (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      marker.setPosition(e.latLng);
      selectedLatLng = { lat, lng };
      reverseGeocode(lat, lng);
    });

    const input = document.getElementById('addressInput');
    if (input) {
      autocomplete = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'za' },
        fields: ['address_components', 'formatted_address', 'geometry']
      });
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place.geometry) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          selectedLatLng = { lat, lng };
          selectedAddress = place.formatted_address;
          const display = document.getElementById('addressDisplay');
          const box = document.getElementById('selectedAddress');
          if (input) input.value = selectedAddress;
          if (display) display.textContent = selectedAddress;
          if (box) box.hidden = false;
          checkDeliverable(selectedAddress);
          updateDeliveryStatus();
          map.setCenter(place.geometry.location);
          marker.setPosition(place.geometry.location);
          map.setZoom(16);
          updateSectionChecks();
          renderTimeSection();
          renderPaymentSection();
        }
      });
    }
  } catch (err) {
    console.error('Error initializing map:', err);
    mapInitialized = false;
  }
};

function reverseGeocode(lat, lng) {
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: { lat, lng } }, (results, status) => {
    if (status === 'OK' && results[0]) {
      const address = results[0].formatted_address;
      selectedAddress = address;
      const input = document.getElementById('addressInput');
      const display = document.getElementById('addressDisplay');
      const box = document.getElementById('selectedAddress');
      if (input) input.value = address;
      if (display) display.textContent = address;
      if (box) box.hidden = false;
      checkDeliverable(address);
      updateDeliveryStatus();
      updateSectionChecks();
      renderTimeSection();
      renderPaymentSection();
    }
  });
}

// ================================================================
//  LEGACY HOURS PARSER (unchanged)
// ================================================================
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseStoreHours(hoursStr) {
  const result = [];
  for (let d = 0; d < 7; d++) {
    result.push({ day: d, open: 8 * 60, close: 18 * 60 });
  }
  if (!hoursStr || typeof hoursStr !== 'string') return result;

  const parts = hoursStr.split(',').map(s => s.trim()).filter(Boolean);
  const parsed = [];

  for (const part of parts) {
    const m = part.match(/^([A-Za-z]{3})(?:\s*-\s*([A-Za-z]{3}))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    if (!m) continue;
    const startIdx = DAY_NAMES.indexOf(capitaliseDay(m[1]));
    const endIdx = m[2] ? DAY_NAMES.indexOf(capitaliseDay(m[2])) : startIdx;
    if (startIdx === -1 || endIdx === -1) continue;
    const openMin = parseTimeToMinutes(m[3]);
    const closeMin = parseTimeToMinutes(m[4]);
    if (openMin == null || closeMin == null) continue;

    if (startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) parsed.push({ day: i, open: openMin, close: closeMin });
    } else {
      for (let i = startIdx; i < 7; i++) parsed.push({ day: i, open: openMin, close: closeMin });
      for (let i = 0; i <= endIdx; i++) parsed.push({ day: i, open: openMin, close: closeMin });
    }
  }

  const final = [];
  for (let d = 0; d < 7; d++) {
    const found = parsed.filter(p => p.day === d);
    final.push(found.length ? found[0] : { day: d, closed: true });
  }
  return final;
}

function capitaliseDay(str) {
  if (!str) return '';
  const s = str.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseTimeToMinutes(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const p = m[3].toLowerCase();
  if (p === 'pm' && h < 12) h += 12;
  if (p === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function formatDate(date) {
  if (!date || typeof date.getDate !== 'function') return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function toISODate(date) {
  if (!date || typeof date.getFullYear !== 'function') return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ================================================================
//  TIME SLOT GENERATION (unchanged)
// ================================================================
function generateTimeSlots() {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  allSlots = [];

  for (let daysAhead = 0; daysAhead <= MAX_DAYS_AHEAD; daysAhead++) {
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    const dow = date.getDay();
    const isoDate = toISODate(date);

    let sessions = storeSessions[dow] || [];
    const override = storeOverrides.find(o => o && o.date === isoDate);
    if (override) {
      sessions = (Array.isArray(override.sessions) ? override.sessions : [])
        .map(s => {
          const open = parseHHMM(s?.open);
          const close = parseHHMM(s?.close);
          if (open == null || close == null || open >= close) return null;
          return { open, close };
        })
        .filter(Boolean);
    }

    if (!sessions.length) continue;

    sessions = sessions.slice().sort((a, b) => a.open - b.open);

    const isToday = daysAhead === 0;
    const earliestAllowed = isToday
      ? Math.ceil((nowMins + LEAD_TIME_MINUTES) / 60) * 60
      : 0;

    const daySlots = [];

    for (const session of sessions) {
      let sessionStart = session.open;
      if (isToday && sessionStart < earliestAllowed) {
        sessionStart = Math.max(session.open, earliestAllowed);
      }

      if (sessionStart >= session.close) continue;

      let start = sessionStart;
      while (start + SLOT_LENGTH_MINUTES <= session.close) {
        const end = start + SLOT_LENGTH_MINUTES;
        const startStr = formatHHMM(start);
        const endStr = formatHHMM(end);
        const timeRange = `${startStr} - ${endStr}`;
        const value = `${isoDate}|${pad2(Math.floor(start / 60))}:${pad2(start % 60)}-${pad2(Math.floor(end / 60))}:${pad2(end % 60)}`;

        let dayLabel;
        if (daysAhead === 0) dayLabel = 'Today';
        else if (daysAhead === 1) dayLabel = 'Tomorrow';
        else dayLabel = `${DAY_NAMES_LONG[dow]} ${date.getDate()}`;

        daySlots.push({
          value,
          display: `${isoDate} (${DAY_NAMES[dow]}) ${timeRange}`,
          dayLabel,
          timeRange,
          dayName: DAY_NAMES_LONG[dow],
          dateStr: isoDate,
          isToday,
          isTomorrow: daysAhead === 1,
          date
        });

        start += SLOT_LENGTH_MINUTES;
      }
    }

    if (daySlots.length) {
      allSlots = daySlots;
      break;
    }
  }

  console.log('🕐 Generated', allSlots.length, 'slots. First:', allSlots[0]?.display);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

// ================================================================
//  SECTION 3 — PAYMENT
// ================================================================
function renderPaymentSection() {
  if (!paymentBody) return;
  const cart = getCart();

  if (cart.length === 0) {
    paymentBody.innerHTML = `
      <div class="payment-locked-note">
        <i class="fas fa-shopping-bag" aria-hidden="true"></i>
        <span>Your cart is empty. <a href="cart.html" style="color:var(--orange);font-weight:700;">Go to cart</a></span>
      </div>
    `;
    return;
  }

  const subtotal = cart.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
  const itemCount = cart.reduce((s, i) => s + (i.quantity || 0), 0);
  const packagingCount = itemCount > 0 ? Math.ceil(itemCount / ITEMS_PER_PACKAGING) : 0;
  const packagingFee = packagingCount * PACKAGING_PRICE;
  
  // Use the calculated fee from the Routes API
  const delivery = subtotal > 0 ? calculatedDeliveryFee : 0;
  const total = subtotal + packagingFee + delivery;

  const canPay = addressConfirmed && isLoggedIn && isDeliverable && calculatedDeliveryFee > 0;

  const walletAvailable = walletBalance > 0;
  const walletCovers = walletBalance >= total;

  const itemsHtml = cart.map(item => `
    <div class="summary-item-row">
      <span class="item-name">${escapeHtml(item.name || '')}</span>
      <span class="item-qty">× ${item.quantity}</span>
      <span class="item-total">R${((item.price || 0) * item.quantity).toFixed(2)}</span>
    </div>
  `).join('');

  const methodsHtml = `
    <div class="payment-methods">
      <div class="payment-method-option ${paymentMethod === 'yoco' ? 'selected' : ''}" data-method="yoco">
        <input type="radio" name="payMethod" id="payYoco" value="yoco" ${paymentMethod === 'yoco' ? 'checked' : ''} />
        <label for="payYoco">
          <i class="fas fa-credit-card" aria-hidden="true"></i>
          <span>Card (Yoco)</span>
        </label>
      </div>
      ${walletAvailable ? `
        <div class="payment-method-option ${paymentMethod === 'wallet' ? 'selected' : ''}" data-method="wallet">
          <input type="radio" name="payMethod" id="payWallet" value="wallet" ${paymentMethod === 'wallet' ? 'checked' : ''} />
          <label for="payWallet">
            <i class="fas fa-wallet" aria-hidden="true"></i>
            <span>Wallet</span>
            <span class="wallet-balance-label">R${walletBalance.toFixed(2)} available</span>
          </label>
        </div>
      ` : ''}
      ${walletAvailable && !walletCovers ? `
        <div class="payment-method-option ${paymentMethod === 'split' ? 'selected' : ''}" data-method="split">
          <input type="radio" name="payMethod" id="paySplit" value="split" ${paymentMethod === 'split' ? 'checked' : ''} />
          <label for="paySplit">
            <i class="fas fa-hand-holding-usd" aria-hidden="true"></i>
            <span>Split payment</span>
            <span class="wallet-balance-label">Wallet R${walletBalance.toFixed(2)} + Card R${(total - walletBalance).toFixed(2)}</span>
          </label>
        </div>
      ` : ''}
    </div>
  `;

  let summaryBlock = '';
  if (paymentMethod === 'wallet' && walletCovers) {
    summaryBlock = `<div class="payment-summary wallet-full"><i class="fas fa-check-circle" aria-hidden="true"></i> Wallet covers the full amount</div>`;
  } else if (paymentMethod === 'split') {
    const w = Math.min(walletBalance, total);
    const c = total - w;
    summaryBlock = `<div class="payment-summary split-payment"><span>Wallet: <strong>R${w.toFixed(2)}</strong></span><span>Card: <strong>R${c.toFixed(2)}</strong></span></div>`;
  } else {
    summaryBlock = `<div class="payment-summary"><i class="fas fa-credit-card" aria-hidden="true"></i> Pay R${total.toFixed(2)} with card</div>`;
  }

  paymentBody.innerHTML = `
    <div class="order-summary-items">${itemsHtml}</div>

    <div class="summary-totals">
      <div class="summary-total-row">
        <span class="label">Subtotal</span>
        <span class="amount">R${subtotal.toFixed(2)}</span>
      </div>
      <div class="summary-total-row">
        <span class="label">Packaging × ${packagingCount}</span>
        <span class="amount">R${packagingFee.toFixed(2)}</span>
      </div>
      <div class="summary-total-row">
        <span class="label">Delivery fee</span>
        <span class="amount">R${delivery.toFixed(2)}</span>
      </div>
      <div class="summary-total-row grand-total">
        <span class="label">Total (estimate)</span>
        <span class="amount">R${total.toFixed(2)}</span>
      </div>
    </div>

    ${walletAvailable ? `
      <div class="wallet-section">
        <div class="wallet-info-display">
          <i class="fas fa-wallet" aria-hidden="true"></i>
          <span>Wallet balance: <strong>R${walletBalance.toFixed(2)}</strong></span>
          ${walletCovers
            ? '<span class="wallet-sufficient">Sufficient</span>'
            : '<span class="wallet-insufficient">Insufficient</span>'}
        </div>
      </div>
    ` : ''}

    ${canPay ? `
      <div class="payment-section">
        <span class="payment-label"><i class="fas fa-money-bill-wave" aria-hidden="true"></i> Payment method</span>
        ${methodsHtml}
        ${summaryBlock}
      </div>
      <button class="btn-place-order" id="placeOrderBtn" type="button">
        <i class="fas fa-lock" aria-hidden="true"></i>
        <span>Pay & Place Order</span>
      </button>
    ` : `
      <div class="payment-locked-note">
        <i class="fas fa-lock" aria-hidden="true"></i>
        <span>Confirm your address and time above to enable payment.</span>
      </div>
    `}
  `;

  if (canPay) {
    paymentBody.querySelectorAll('.payment-method-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const m = opt.dataset.method;
        const radio = opt.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        paymentMethod = m;
        renderPaymentSection();
      });
    });

    const btn = document.getElementById('placeOrderBtn');
    if (btn) btn.addEventListener('click', placeOrder);
  }
}

// ================================================================
//  PLACE ORDER
// ================================================================
async function placeOrder() {
  if (isProcessingPayment) return;

  const cart = getCart();
  if (cart.length === 0) { showToast('Your cart is empty.'); return; }
  if (!addressConfirmed) { showToast('Please confirm your delivery address and time first.'); return; }
  if (!isLoggedIn) { showToast('Please sign in to place your order.'); return; }

  const btn = document.getElementById('placeOrderBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Processing...</span>';
  }
  isProcessingPayment = true;

  try {
    let idempotencyKey = sessionStorage.getItem('gs_checkout_idem');
    if (!idempotencyKey) {
      idempotencyKey = 'ico_' + Date.now().toString(36) + '_' +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('gs_checkout_idem', idempotencyKey);
    }

    const createCardOrder = httpsCallable(functions, 'createCardOrder');

    const payload = {
      items: cart.map(item => ({
        id: item.id,
        productId: item.productId || null,
        quantity: Number(item.quantity) || 1
      })),
      paymentMethod,
      deliveryAddress: {
        street: selectedAddress || '',
        lat: selectedLatLng?.lat || 0,
        lng: selectedLatLng?.lng || 0
      },
      timeSlotDisplay: selectedTimeSlotDisplay || selectedTimeSlot || '',
      customerPhone: currentUser.phoneNumber || '',
      idempotencyKey
    };

    const result = await createCardOrder(payload);
    const data = result?.data || {};

    if (data.inProgress) {
      sessionStorage.removeItem('gs_checkout_idem');
      showToast('Your previous attempt is still processing. Please check My Orders in a moment.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i><span>Pay & Place Order</span>';
      }
      isProcessingPayment = false;
      return;
    }

    if (!data.success) {
      if (!data.idempotentReplay) {
        sessionStorage.removeItem('gs_checkout_idem');
      }
      throw new Error(data.message || data.error || 'Could not place order.');
    }

    // --- SAVE THE ADDRESS NOW THAT THE ORDER IS SUCCESSFUL ---
    saveAddressToUser(); 
    // ---------------------------------------------------------

    localStorage.removeItem(CART_KEY);
    updateCartBadge();
    sessionStorage.removeItem('gs_checkout_idem');

    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
      return;
    }

    throw new Error('No redirect URL received from server.');

  } catch (error) {
    console.error('Error placing order:', error);
    let msg = 'Could not place order. Please try again.';
    if (error?.message) msg = error.message;
    if (error?.details) msg = error.details;
    showToast(msg);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i><span>Pay & Place Order</span>';
    }
    isProcessingPayment = false;
  }
}

// ================================================================
//  CLOUDSKUNK MODAL
// ================================================================
function initCloudskunkModal() {
  if (!cloudskunkModal) return;

  cloudskunkModal.querySelectorAll('[data-cloudskunk-close]').forEach(el => {
    el.addEventListener('click', closeCloudskunk);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cloudskunkModal.classList.contains('open')) {
      closeCloudskunk();
    }
  });

  if (cloudskunkInfoLink) {
    cloudskunkInfoLink.addEventListener('click', (e) => {
      e.preventDefault();
      openCloudskunk();
    });
  }
}

function openCloudskunk() {
  if (!cloudskunkModal) return;
  cloudskunkModal.hidden = false;
  requestAnimationFrame(() => cloudskunkModal.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeCloudskunk() {
  if (!cloudskunkModal) return;
  cloudskunkModal.classList.remove('open');
  setTimeout(() => {
    cloudskunkModal.hidden = true;
    document.body.style.overflow = '';
  }, 250);
}

// ================================================================
//  HELPERS
// ================================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.openNotificationModal = function () {
  showToast('No new alerts right now.');
};