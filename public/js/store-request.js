// ============================================================
//  store-request.js — Shared "Can't find your store?" modal
//
//  Used by index.js (homepage) and stores.js (stores page).
//
//  Writes to Firestore collection: storeRequests
//  Schema:
//    storeName      string   — the store they want
//    location       string   — area / suburb
//    name           string   — customer's name (mandatory)
//    contact        string   — customer's phone (mandatory, >=9 digits)
//    customerId     string|null
//    customerPhone  string
//    status         'pending'
//    createdAt      Timestamp
// ============================================================

import {
  db,
  collection,
  addDoc,
  serverTimestamp
} from './firebase-config.js';

import { auth } from './firebase-config.js';
import { showToast } from './global.js';

// ---- DOM (looked up lazily on first open) --------------------
let _modal = null;
let _fields = {};
let _wired = false;

function lookupDom() {
  if (_modal) return true;
  _modal = document.getElementById('storeRequestModal');
  if (!_modal) return false;

  _fields = {
    storeName: document.getElementById('storeRequestStoreName'),
    location:  document.getElementById('storeRequestLocation'),
    name:      document.getElementById('storeRequestName'),
    contact:   document.getElementById('storeRequestContact'),
    submitBtn: document.getElementById('storeRequestSubmit')
  };
  return true;
}

// ---- Phone helpers (mirrors the item-request pattern) --------
function phoneToLocalDigits(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

function prefillContact() {
  if (!_fields.contact) return;
  if (_fields.contact.value && _fields.contact.value.trim()) return;
  const user = auth?.currentUser;
  if (!user) return;
  const local = phoneToLocalDigits(user.phoneNumber || '');
  if (local) _fields.contact.value = '0' + local;
}

// ---- Open / close --------------------------------------------
export function openStoreRequestModal() {
  if (!lookupDom()) {
    console.warn('store-request: modal markup not found');
    return;
  }

  // Reset fields
  if (_fields.storeName) _fields.storeName.value = '';
  if (_fields.location)  _fields.location.value  = '';
  if (_fields.name)      _fields.name.value      = '';
  if (_fields.contact)   _fields.contact.value   = '';

  prefillContact();

  _modal.hidden = false;
  requestAnimationFrame(() => _modal.classList.add('open'));
  document.body.style.overflow = 'hidden';

  setTimeout(() => _fields.storeName?.focus(), 300);
}

export function closeStoreRequestModal() {
  if (!_modal) return;
  _modal.classList.remove('open');
  setTimeout(() => {
    _modal.hidden = true;
    document.body.style.overflow = '';
  }, 250);
}

// ---- Wire the modal once -------------------------------------
function wireModal() {
  if (_wired) return;
  if (!lookupDom()) return;
  _wired = true;

  _modal.querySelectorAll('[data-store-request-close]').forEach(el => {
    el.addEventListener('click', closeStoreRequestModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _modal.classList.contains('open')) {
      closeStoreRequestModal();
    }
  });

  // Re-prefill if a signed-in user arrives after page load
  if (auth && typeof auth.onAuthStateChanged === 'function') {
    auth.onAuthStateChanged(() => prefillContact());
  }

  _fields.submitBtn?.addEventListener('click', submitStoreRequest);
}

// ---- Submit --------------------------------------------------
async function submitStoreRequest() {
  const storeName = (_fields.storeName?.value || '').trim();
  const location  = (_fields.location?.value  || '').trim();
  const name      = (_fields.name?.value      || '').trim();
  const contact   = (_fields.contact?.value   || '').trim();

  // Validation
  if (!storeName) {
    showToast('Please type the name of the store you\'re looking for.');
    _fields.storeName?.focus();
    return;
  }
  if (!location) {
    showToast('Please tell us the area or location of the store.');
    _fields.location?.focus();
    return;
  }
  if (!name) {
    showToast('Please tell us your name.');
    _fields.name?.focus();
    return;
  }

  const contactDigits = contact.replace(/\D/g, '');
  if (contactDigits.length < 9) {
    showToast('Please enter your mobile number so we can update you.');
    _fields.contact?.focus();
    return;
  }

  const btn = _fields.submitBtn;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> <span>Sending...</span>';
  }

  try {
    const user = auth?.currentUser;
    await addDoc(collection(db, 'storeRequests'), {
      storeName,
      location,
      name,
      contact,
      customerId: user?.uid || null,
      customerPhone: user?.phoneNumber || '',
      status: 'pending',
      createdAt: serverTimestamp()
    });

    showToast('Thank you for your feedback, you will be notified once the store joins.');
    closeStoreRequestModal();
  } catch (err) {
    console.error('Store request error:', err);
    showToast('Could not send. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> <span>Send request</span>';
    }
  }
}

// ---- Init (called by pages) ---------------------------------
export function initStoreRequest() {
  if (!lookupDom()) return;
  wireModal();
  prefillContact();
}

// ---- Tile builder (used by index.js / stores.js) -------------
// Returns an HTML string for the "Can't find your store?" tile.
// Pages insert it after their store cards and wire the click.
export function buildStoreRequestTileHtml() {
  return `
    <button type="button" class="store-card store-request-tile" data-store-request-open>
      <div class="store-request-tile-inner">
        <span class="store-request-tile-icon">
          <i class="fas fa-store-slash" aria-hidden="true"></i>
        </span>
        <span class="store-request-tile-label">Can't find your store?</span>
        <span class="store-request-tile-sub">Tell us which store you'd like on Ghost Shopper</span>
      </div>
    </button>
  `;
}

// ---- Delegated click handler (bind once per page) ------------
export function wireStoreRequestTile(container) {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-store-request-open]');
    if (!tile) return;
    e.preventDefault();
    e.stopPropagation();
    openStoreRequestModal();
  });
}