// ============================================================
//  STORES.JS - Store management module
//  Includes: store CRUD + Flyers & Catalogs manager
//  Hours: structured openingHours (7 days, multi-session per
//  day) + hoursOverrides (dated one-off exceptions). The old
//  flat `hours` string is written on save for backwards compat.
// ============================================================

import {
  db, storage, functions, httpsCallable,
  collection, query, where, orderBy, getDocs, onSnapshot,
  doc, getDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, setDoc
} from '../../js/firebase-config.js';

import { increment } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

import { showToast, showLoading, formatMoney, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');
let storesUnsubscribe = null;

const MAX_FLYERS = 10;
const FLYER_MAX_DIMENSION = 1600;
const FLYER_JPEG_QUALITY = 0.88;
const FLYER_MAX_BYTES = 900 * 1024;

// Days in the order the weekly grid shows them.
const DAYS = [
  { key: 'mon', short: 'Mon', long: 'Monday'    },
  { key: 'tue', short: 'Tue', long: 'Tuesday'   },
  { key: 'wed', short: 'Wed', long: 'Wednesday' },
  { key: 'thu', short: 'Thu', long: 'Thursday'  },
  { key: 'fri', short: 'Fri', long: 'Friday'    },
  { key: 'sat', short: 'Sat', long: 'Saturday'  },
  { key: 'sun', short: 'Sun', long: 'Sunday'    }
];

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Map JS getDay() index -> our DAYS key
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

window.loadStores = loadStores;
window.editStore = editStore;
window.deleteStore = deleteStore;
window.toggleStoreClosed = toggleStoreClosed;
window.openStoreModal = openStoreModal;

// ============================================================
//  CACHE VERSION BUMP
// ============================================================
async function bumpCatalogVersion() {
  try {
    await setDoc(doc(db, 'settings', 'catalog'), {
      version: increment(1)
    }, { merge: true });
    console.log('✅ Catalog cache version bumped');
  } catch (e) {
    console.warn('Could not bump catalog version:', e);
  }
}

// ============================================================
//  LOAD STORES
// ============================================================
export function loadStores() {
  showLoading('Loading stores...');

  if (storesUnsubscribe) storesUnsubscribe();

  const storesRef = collection(db, 'stores');
  const q = query(storesRef, orderBy('name'));

  storesUnsubscribe = onSnapshot(q, (snapshot) => {
    const stores = [];
    snapshot.forEach(doc => {
      stores.push({ id: doc.id, ...doc.data() });
    });

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>Stores</h3>
        <button class="btn-primary" onclick="openStoreModal()">
          <i class="fas fa-plus"></i> Add Store
        </button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Logo</th>
              <th>Name</th>
              <th>Category</th>
              <th>Address</th>
              <th>Hours</th>
              <th>Flyers</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (stores.length === 0) {
      html += `<tr><td colspan="8" style="text-align:center;padding:1rem;color:var(--text-secondary);">No stores found. Add your first store!</td></tr>`;
    } else {
      stores.forEach(store => {
        const isClosed = store.temporarilyClosed === true;
        const flyerCount = Array.isArray(store.flyers) ? store.flyers.length : 0;
        const now = Date.now();
        const activeFlyers = (store.flyers || []).filter(f => {
          const start = tsToMillis(f.startDate);
          const end = tsToMillis(f.endDate);
          if (start && start > now) return false;
          if (end && end < now) return false;
          return true;
        }).length;

        const hasCoords = typeof store.lat === 'number' && typeof store.lng === 'number';
        const coordsBadge = hasCoords ? '' : `<span style="font-size:0.7rem;background:#FEE2E2;color:#991B1B;padding:2px 6px;border-radius:4px;margin-left:6px;" title="Geocode failed or missing">⚠️ Missing Coords</span>`;

        html += `
          <tr>
            <td><img src="${store.logo || 'img/placeholder.jpg'}" alt="${store.name}" style="width:40px;height:40px;object-fit:cover;border-radius:50%;"></td>
            <td><strong>${store.name || 'N/A'}</strong> ${coordsBadge}</td>
            <td>${store.category || 'N/A'}</td>
            <td style="font-size:0.8rem;">${store.address || 'N/A'}</td>
            <td style="font-size:0.8rem;">${store.hours || 'N/A'}</td>
            <td style="font-size:0.8rem;text-align:center;">${activeFlyers} / ${flyerCount}</td>
            <td>${isClosed ? '<span class="status-badge status-pending">🔴 Closed</span>' : '<span class="status-badge status-confirmed">🟢 Open</span>'}</td>
            <td>
              <button class="btn-sm btn-edit" onclick="editStore('${store.id}')"><i class="fas fa-pen"></i></button>
              <button class="btn-sm ${isClosed ? 'btn-approve' : 'btn-warning'}" onclick="toggleStoreClosed('${store.id}','${!isClosed}')" style="${isClosed ? '' : 'background:#FFC107;color:#030E38;'}">
                ${isClosed ? 'Open' : 'Close'}
              </button>
              <button class="btn-sm btn-delete" onclick="deleteStore('${store.id}')"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;
  }, (error) => {
    console.error('Error loading stores:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading stores.</p>`;
  });
}

// ===== TOGGLE STORE CLOSED =====
export async function toggleStoreClosed(storeId, close) {
  if (!confirm(`${close ? 'Close' : 'Open'} this store? ${close ? 'Customers will not be able to order.' : 'Customers will be able to order again.'}`)) return;
  try {
    await updateDoc(doc(db, 'stores', storeId), {
      temporarilyClosed: close,
      updatedAt: serverTimestamp()
    });
    showToast(`✅ Store ${close ? 'closed' : 'opened'}!`);
    loadStores();
  } catch (error) {
    console.error('Error toggling store status:', error);
    showToast('❌ Failed to update store status.');
  }
}

// ============================================================
//  HOURS — parse + format helpers
// ============================================================

// Default shape used when a store has neither openingHours nor
// a parseable hours string: every day closed, no overrides.
function emptyOpeningHours() {
  const out = {};
  DAYS.forEach(d => { out[d.key] = { sessions: [] }; });
  return out;
}

// Parse the OLD flat hours string into the new structured shape.
// Accepts patterns like:
//   "Mon-Fri 7:30am-6pm, Sat 7am-6pm, Sun 7:30am-5pm"
//   "Mon-Sat 08:00-18:00"
//   "24/7" (spreads 00:00-23:59 across every day)
//   "Closed" / "" (every day closed)
// Days not mentioned are left closed (sessions: []).
function parseLegacyHoursToStructured(hoursStr) {
  const out = emptyOpeningHours();
  if (!hoursStr || typeof hoursStr !== 'string') return out;

  const lower = hoursStr.toLowerCase().trim();
  if (!lower) return out;
  if (lower.includes('24/7') || lower.includes('24 hours')) {
    DAYS.forEach(d => { out[d.key].sessions = [{ open: '00:00', close: '23:59' }]; });
    return out;
  }

  const parts = hoursStr.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Matches: "Mon-Fri 7:30am-6pm" | "Mon 08:00-18:00" | "Mon-Sat 7am - 6pm"
    const m = part.match(
      /^([A-Za-z]{3})(?:\s*-\s*([A-Za-z]{3}))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    );
    if (!m) continue;

    const startKey = capitaliseDay(m[1]);
    const endKey   = m[2] ? capitaliseDay(m[2]) : startKey;
    const startIdx = DAY_NAMES_SHORT.indexOf(startKey);
    const endIdx   = DAY_NAMES_SHORT.indexOf(endKey);
    if (startIdx === -1 || endIdx === -1) continue;

    const open  = parseTimeStringToHHMM(m[3]);
    const close = parseTimeStringToHHMM(m[4]);
    if (!open || !close) continue;

    const indices = [];
    if (startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) indices.push(i);
    } else {
      for (let i = startIdx; i < 7; i++) indices.push(i);
      for (let i = 0; i <= endIdx; i++) indices.push(i);
    }

    indices.forEach(i => {
      const key = JS_DAY_TO_KEY[i];
      out[key].sessions.push({ open, close });
    });
  }

  return out;
}

function capitaliseDay(str) {
  if (!str) return '';
  const s = str.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "7:30am" -> "07:30", "18:00" -> "18:00", "6pm" -> "18:00"
function parseTimeStringToHHMM(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const period = (m[3] || '').toLowerCase();
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

// Coerce any incoming openingHours shape into our canonical one.
// Guards against partial data, bad keys, empty arrays, etc.
function normaliseOpeningHours(raw) {
  const out = emptyOpeningHours();
  if (!raw || typeof raw !== 'object') return out;

  DAYS.forEach(d => {
    const dayRaw = raw[d.key];
    if (!dayRaw) return;
    const sessions = Array.isArray(dayRaw.sessions) ? dayRaw.sessions : [];
    out[d.key].sessions = sessions
      .map(s => {
        const open  = normaliseHHMM(s?.open);
        const close = normaliseHHMM(s?.close);
        if (!open || !close || open >= close) return null;
        return { open, close };
      })
      .filter(Boolean);
  });

  return out;
}

function normaliseHHMM(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

// Normalise overrides array. Each entry: { date: "YYYY-MM-DD", sessions: [...] }
function normaliseOverrides(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(o => {
      const date = typeof o?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
      if (!date) return null;
      const sessions = Array.isArray(o.sessions)
        ? o.sessions
            .map(s => {
              const open  = normaliseHHMM(s?.open);
              const close = normaliseHHMM(s?.close);
              if (!open || !close || open >= close) return null;
              return { open, close };
            })
            .filter(Boolean)
        : [];
      return { date, sessions };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Format minutes-since-midnight OR "HH:MM" string -> "HH:MM" 24h
function hhmmFromAnything(v) {
  if (typeof v === 'string') return normaliseHHMM(v) || '';
  if (typeof v === 'number') {
    const h = Math.floor(v / 60);
    const m = v % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  return '';
}

// Build the human-readable fallback string from structured data.
// Between-sessions in one day are joined with " & ".
// Between days joined with "; ".
// Sunday shown explicitly so "closed" is clear.
function buildLegacyHoursString(openingHours) {
  const dayParts = [];
  DAYS.forEach(d => {
    const sessions = openingHours[d.key]?.sessions || [];
    if (!sessions.length) {
      // only mention closed if ANY day has sessions (otherwise all-closed)
      dayParts.push(`${d.short} closed`);
      return;
    }
    const s = sessions.map(x => `${x.open}-${x.close}`).join(' & ');
    dayParts.push(`${d.short} ${s}`);
  });

  // If every single day is closed, just say "Closed".
  const allClosed = DAYS.every(d => !(openingHours[d.key]?.sessions || []).length);
  if (allClosed) return 'Closed';

  return dayParts.join('; ');
}

// ============================================================
//  STORE MODAL
// ============================================================
export function openStoreModal(storeData = null) {
  const isEdit = !!storeData;
  const existingFlyers = Array.isArray(storeData?.flyers) ? [...storeData.flyers] : [];

  const modal = openModal(`
    <div class="modal-content" style="max-width:840px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit' : 'Add'} Store</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">

        <div class="form-group">
          <label>Store Name *</label>
          <input type="text" id="storeName" value="${escapeAttr(storeData?.name || '')}" placeholder="e.g. Golden Gate Super" />
        </div>
        <div class="form-group">
          <label>Category *</label>
          <select id="storeCategory">
            <option value="supermarket" ${storeData?.category === 'supermarket' ? 'selected' : ''}>Supermarket</option>
            <option value="butchery" ${storeData?.category === 'butchery' ? 'selected' : ''}>Butchery</option>
            <option value="bakery" ${storeData?.category === 'bakery' ? 'selected' : ''}>Bakery</option>
            <option value="pharmacy" ${storeData?.category === 'pharmacy' ? 'selected' : ''}>Pharmacy</option>
            <option value="other" ${storeData?.category === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Store Address *</label>
          <input type="text" id="storeAddress" value="${escapeAttr(storeData?.address || '')}" placeholder="e.g. 123 Main St, Verulam" />
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">We will auto-detect the coordinates for this address when you save.</p>
        </div>
        <div class="form-group">
          <label>Phone Number *</label>
          <input type="text" id="storePhone" value="${escapeAttr(storeData?.phone || '')}" placeholder="e.g. 031 123 4567" />
        </div>
        <div class="form-group">
          <label>WhatsApp Primary (for orders) *</label>
          <input type="text" id="storeWhatsAppPrimary" value="${escapeAttr(storeData?.whatsappPrimary || '')}" placeholder="+27 82 123 4567" />
        </div>
        <div class="form-group">
          <label>WhatsApp Secondary (optional)</label>
          <input type="text" id="storeWhatsAppSecondary" value="${escapeAttr(storeData?.whatsappSecondary || '')}" placeholder="+27 82 987 6543" />
        </div>
        <div class="form-group">
          <label>Logo URL</label>
          <input type="text" id="storeLogo" value="${escapeAttr(storeData?.logo || '')}" placeholder="https://example.com/logo.jpg" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="storeDescription" rows="2" placeholder="Store description...">${escapeHtml(storeData?.description || '')}</textarea>
        </div>

        <!-- ============= TRADING HOURS ============= -->
        <hr class="admin-divider" />
        <div class="hours-section-head">
          <div>
            <h4 style="margin:0 0 2px;font-size:1rem;color:var(--navy);display:inline-flex;align-items:center;gap:8px;">
              <i class="fas fa-clock" style="color:var(--orange);"></i>
              Trading Hours
            </h4>
            <p style="margin:0;font-size:0.78rem;color:var(--text-muted);">
              All times are 24-hour format (e.g. 07:30, 18:00). Add multiple sessions per day for lunch breaks.
            </p>
          </div>
        </div>
        <div class="hours-grid" id="hoursGrid"></div>

        <div class="hours-overrides-section">
          <div class="hours-overrides-head">
            <div>
              <h4 style="margin:0 0 2px;font-size:0.92rem;color:var(--navy);display:inline-flex;align-items:center;gap:8px;">
                <i class="fas fa-calendar-day" style="color:var(--orange);"></i>
                Holiday &amp; Exception Hours
              </h4>
              <p style="margin:0;font-size:0.74rem;color:var(--text-muted);">
                Optional one-off dates that override the weekly hours. Leave empty to keep the day closed, or add sessions to open.
              </p>
            </div>
            <button type="button" class="btn-secondary small" id="addOverrideBtn">
              <i class="fas fa-plus"></i> Add date
            </button>
          </div>
          <div class="hours-overrides-list" id="overridesList"></div>
          <p class="hours-overrides-empty" id="overridesEmpty">No holiday or exception dates set.</p>
        </div>

        <div class="hours-preview" id="hoursPreviewWrap">
          <div class="hours-preview-label">
            <i class="fas fa-eye"></i> Weekly summary (shown on the storefront)
          </div>
          <div class="hours-preview-line" id="hoursPreviewLine">—</div>
        </div>
        <!-- ============= END TRADING HOURS ============= -->

        <div class="form-group" style="margin-top:14px;">
          <label>Popular</label>
          <select id="storePopular">
            <option value="true" ${storeData?.popular === true ? 'selected' : ''}>Yes</option>
            <option value="false" ${storeData?.popular !== true ? 'selected' : ''}>No</option>
          </select>
        </div>
        <div class="form-group">
          <label>Tags (comma separated)</label>
          <input type="text" id="storeTags" value="${escapeAttr(storeData?.tags?.join(', ') || '')}" placeholder="Grocery, Fresh, Halal" />
        </div>
        <div class="form-group">
          <label>Temporarily Closed</label>
          <select id="storeClosed">
            <option value="false" ${storeData?.temporarilyClosed !== true ? 'selected' : ''}>Open</option>
            <option value="true" ${storeData?.temporarilyClosed === true ? 'selected' : ''}>Closed</option>
          </select>
        </div>

        <hr class="admin-divider" />

        <div class="flyer-section-head">
          <div>
            <h4 style="margin:0 0 2px;font-size:1rem;color:var(--navy);display:inline-flex;align-items:center;gap:8px;">
              <i class="fas fa-file-image" style="color:var(--blue,#3B82F6);"></i>
              Flyers &amp; Catalogs
            </h4>
            <p style="margin:0;font-size:0.78rem;color:var(--text-muted);">
              Up to ${MAX_FLYERS} flyers. Each flyer can have 1 or 2 pages.
              Flyers auto-hide after their end date.
            </p>
          </div>
          <button type="button" class="btn-secondary" id="addFlyerBtn">
            <i class="fas fa-plus"></i> Add Flyer
          </button>
        </div>

        <div class="flyer-list" id="flyerList"></div>
        <p class="flyer-empty" id="flyerEmpty">No flyers yet. Click "Add Flyer" to get started.</p>

      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveStoreBtn">${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </div>
  `);

  // ============================================================
  //  HOURS STATE + RENDER
  // ============================================================
  let hoursState = storeData?.openingHours
    ? normaliseOpeningHours(storeData.openingHours)
    : parseLegacyHoursToStructured(storeData?.hours || '');

  let overridesState = normaliseOverrides(storeData?.hoursOverrides);

  const hoursGridEl = modal.querySelector('#hoursGrid');
  const overridesListEl = modal.querySelector('#overridesList');
  const overridesEmptyEl = modal.querySelector('#overridesEmpty');
  const previewLineEl = modal.querySelector('#hoursPreviewLine');
  const addOverrideBtn = modal.querySelector('#addOverrideBtn');

  function renderHoursGrid() {
    hoursGridEl.innerHTML = DAYS.map(d => {
      const sessions = hoursState[d.key]?.sessions || [];
      const isClosed = sessions.length === 0;

      const sessionsHtml = sessions.map((s, idx) => `
        <div class="hours-session-row" data-day="${d.key}" data-idx="${idx}">
          <input type="text" class="hours-session-time" data-field="open"  value="${escapeAttr(s.open)}"  placeholder="07:30" maxlength="5" inputmode="numeric" aria-label="${d.long} opening time" />
          <span class="hours-session-dash">→</span>
          <input type="text" class="hours-session-time" data-field="close" value="${escapeAttr(s.close)}" placeholder="18:00" maxlength="5" inputmode="numeric" aria-label="${d.long} closing time" />
          <button type="button" class="hours-session-remove" data-action="remove-session" data-day="${d.key}" data-idx="${idx}" aria-label="Remove session">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `).join('');

      return `
        <div class="hours-day" data-day="${d.key}">
          <div class="hours-day-head">
            <span class="hours-day-name">${d.long}</span>
            <label class="hours-day-toggle">
              <input type="checkbox" data-action="toggle-day" data-day="${d.key}" ${isClosed ? 'checked' : ''} />
              <span class="hours-day-toggle-label">${isClosed ? 'Closed' : 'Open'}</span>
            </label>
          </div>
          <div class="hours-day-body">
            ${isClosed
              ? `<div class="hours-day-closed-note"><i class="fas fa-moon"></i> Closed all day</div>`
              : `<div class="hours-sessions">${sessionsHtml}</div>`
            }
            <button type="button" class="hours-add-session-btn" data-action="add-session" data-day="${d.key}">
              <i class="fas fa-plus"></i> Add hours
            </button>
          </div>
        </div>
      `;
    }).join('');

    hoursGridEl.querySelectorAll('input.hours-session-time').forEach(input => {
      input.addEventListener('input', () => {
        const row = input.closest('.hours-session-row');
        const day = row.dataset.day;
        const idx = parseInt(row.dataset.idx, 10);
        const field = input.dataset.field;
        const normalised = autoFormatTime(input.value);
        if (normalised !== null) {
          hoursState[day].sessions[idx][field] = normalised;
        }
        updatePreview();
      });
      input.addEventListener('blur', () => {
        const row = input.closest('.hours-session-row');
        const day = row.dataset.day;
        const idx = parseInt(row.dataset.idx, 10);
        const field = input.dataset.field;
        const raw = input.value.trim();
        if (!raw) {
          input.style.borderColor = 'var(--red)';
          return;
        }
        const parsed = parseAnyTimeInput(raw);
        if (!parsed) {
          input.style.borderColor = 'var(--red)';
          showToast(`"${raw}" is not a valid time. Use HH:MM (e.g. 07:30).`);
          return;
        }
        input.style.borderColor = '';
        input.value = parsed;
        hoursState[day].sessions[idx][field] = parsed;
        updatePreview();
      });
    });

    hoursGridEl.querySelectorAll('[data-action="remove-session"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx, 10);
        hoursState[day].sessions.splice(idx, 1);
        renderHoursGrid();
        updatePreview();
      });
    });

    hoursGridEl.querySelectorAll('[data-action="add-session"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = btn.dataset.day;
        hoursState[day].sessions.push({ open: '', close: '' });
        renderHoursGrid();
        updatePreview();
        const dayEl = hoursGridEl.querySelector(`.hours-day[data-day="${day}"]`);
        const inputs = dayEl?.querySelectorAll('input.hours-session-time');
        if (inputs && inputs.length) inputs[inputs.length - 2]?.focus();
      });
    });

    hoursGridEl.querySelectorAll('input[data-action="toggle-day"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const day = chk.dataset.day;
        if (chk.checked) {
          hoursState[day].sessions = [];
        } else {
          if (!hoursState[day].sessions.length) {
            hoursState[day].sessions.push({ open: '', close: '' });
          }
        }
        renderHoursGrid();
        updatePreview();
      });
    });
  }

  function autoFormatTime(raw) {
    if (typeof raw !== 'string') return null;
    let v = raw.replace(/[^\d:]/g, '');
    if (/^\d{4}$/.test(v)) v = v.slice(0, 2) + ':' + v.slice(2);
    return normaliseHHMM(v);
  }

  function parseAnyTimeInput(raw) {
    if (!raw) return null;
    let v = String(raw).trim().replace(/[^\d:]/g, '');
    if (!v) return null;
    if (/^\d{3,4}$/.test(v)) {
      if (v.length === 3) v = '0' + v;
      v = v.slice(0, 2) + ':' + v.slice(2);
    } else if (/^\d{1,2}$/.test(v)) {
      v = String(parseInt(v, 10)).padStart(2, '0') + ':00';
    }
    return normaliseHHMM(v);
  }

  function renderOverrides() {
    if (!overridesState.length) {
      overridesListEl.innerHTML = '';
      overridesEmptyEl.hidden = false;
      return;
    }
    overridesEmptyEl.hidden = true;

    overridesListEl.innerHTML = overridesState.map((o, i) => {
      const sessions = Array.isArray(o.sessions) ? o.sessions : [];
      const isClosed = sessions.length === 0;

      const sessionsHtml = sessions.map((s, idx) => `
        <div class="hours-session-row" data-ovr="${i}" data-idx="${idx}">
          <input type="text" class="hours-session-time" data-field="open"  value="${escapeAttr(s.open)}"  placeholder="07:30" maxlength="5" inputmode="numeric" />
          <span class="hours-session-dash">→</span>
          <input type="text" class="hours-session-time" data-field="close" value="${escapeAttr(s.close)}" placeholder="18:00" maxlength="5" inputmode="numeric" />
          <button type="button" class="hours-session-remove" data-action="remove-ovr-session" data-ovr="${i}" data-idx="${idx}">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `).join('');

      return `
        <div class="hours-override-row" data-ovr="${i}">
          <div class="hours-override-head">
            <input type="text" class="hours-override-date" data-action="ovr-date" data-ovr="${i}" value="${escapeAttr(o.date)}" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric" />
            <label class="hours-day-toggle">
              <input type="checkbox" data-action="ovr-toggle-closed" data-ovr="${i}" ${isClosed ? 'checked' : ''} />
              <span class="hours-day-toggle-label">${isClosed ? 'Closed' : 'Open'}</span>
            </label>
            <button type="button" class="hours-override-remove" data-action="remove-override" data-ovr="${i}" aria-label="Remove override">
              <i class="fas fa-trash"></i>
            </button>
          </div>
          <div class="hours-override-body">
            ${isClosed
              ? `<div class="hours-day-closed-note"><i class="fas fa-moon"></i> Closed on this date</div>`
              : `<div class="hours-sessions">${sessionsHtml}</div>`
            }
            <button type="button" class="hours-add-session-btn" data-action="add-ovr-session" data-ovr="${i}">
              <i class="fas fa-plus"></i> Add hours
            </button>
          </div>
        </div>
      `;
    }).join('');

    overridesListEl.querySelectorAll('input[data-action="ovr-date"]').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = parseInt(inp.dataset.ovr, 10);
        const v = inp.value.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          inp.style.borderColor = 'var(--red)';
          return;
        }
        inp.style.borderColor = '';
        overridesState[i].date = v;
        updatePreview();
      });
    });

    overridesListEl.querySelectorAll('input[data-action="ovr-toggle-closed"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const i = parseInt(chk.dataset.ovr, 10);
        if (chk.checked) {
          overridesState[i].sessions = [];
        } else if (!overridesState[i].sessions.length) {
          overridesState[i].sessions.push({ open: '', close: '' });
        }
        renderOverrides();
        updatePreview();
      });
    });

    overridesListEl.querySelectorAll('input.hours-session-time').forEach(input => {
      input.addEventListener('input', () => {
        const row = input.closest('.hours-session-row');
        const i = parseInt(row.dataset.ovr, 10);
        const idx = parseInt(row.dataset.idx, 10);
        const field = input.dataset.field;
        const norm = autoFormatTime(input.value);
        if (norm) overridesState[i].sessions[idx][field] = norm;
        updatePreview();
      });
      input.addEventListener('blur', () => {
        const row = input.closest('.hours-session-row');
        const i = parseInt(row.dataset.ovr, 10);
        const idx = parseInt(row.dataset.idx, 10);
        const field = input.dataset.field;
        const raw = input.value.trim();
        if (!raw) { input.style.borderColor = 'var(--red)'; return; }
        const parsed = parseAnyTimeInput(raw);
        if (!parsed) {
          input.style.borderColor = 'var(--red)';
          showToast(`"${raw}" is not a valid time. Use HH:MM.`);
          return;
        }
        input.style.borderColor = '';
        input.value = parsed;
        overridesState[i].sessions[idx][field] = parsed;
        updatePreview();
      });
    });

    overridesListEl.querySelectorAll('[data-action="add-ovr-session"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ovr, 10);
        overridesState[i].sessions.push({ open: '', close: '' });
        renderOverrides();
        updatePreview();
      });
    });

    overridesListEl.querySelectorAll('[data-action="remove-ovr-session"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ovr, 10);
        const idx = parseInt(btn.dataset.idx, 10);
        overridesState[i].sessions.splice(idx, 1);
        renderOverrides();
        updatePreview();
      });
    });

    overridesListEl.querySelectorAll('[data-action="remove-override"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ovr, 10);
        if (!confirm(`Remove this date override (${overridesState[i].date})?`)) return;
        overridesState.splice(i, 1);
        renderOverrides();
        updatePreview();
      });
    });
  }

  function updatePreview() {
    const cleaned = buildLegacyHoursString(hoursState);
    const ovrCount = overridesState.length;
    const ovrNote = ovrCount ? ` · ${ovrCount} date override${ovrCount === 1 ? '' : 's'}` : '';
    previewLineEl.textContent = cleaned + ovrNote;
  }

  addOverrideBtn.addEventListener('click', () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    overridesState.push({ date: `${yyyy}-${mm}-${dd}`, sessions: [] });
    renderOverrides();
    updatePreview();
    const rows = overridesListEl.querySelectorAll('.hours-override-row');
    rows[rows.length - 1]?.querySelector('.hours-override-date')?.focus();
  });

  renderHoursGrid();
  renderOverrides();
  updatePreview();

  // ============================================================
  //  FLYER STATE + RENDER
  // ============================================================
  let flyerState = existingFlyers.map((f, idx) => ({
    slotId: f.slotId || String(idx + 1),
    title: f.title || 'Flyer',
    pages: Array.isArray(f.pages) ? [...f.pages] : (f.image ? [f.image] : []),
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    uploadedAt: f.uploadedAt || null,
    _newFiles: []
  }));

  const flyerListEl = modal.querySelector('#flyerList');
  const flyerEmptyEl = modal.querySelector('#flyerEmpty');
  const addFlyerBtn = modal.querySelector('#addFlyerBtn');

  function renderFlyerList() {
    if (flyerState.length === 0) {
      flyerListEl.innerHTML = '';
      flyerEmptyEl.hidden = false;
      return;
    }
    flyerEmptyEl.hidden = true;

    flyerListEl.innerHTML = flyerState.map((f, i) => {
      const startStr = tsToDateInput(f.startDate);
      const endStr = tsToDateInput(f.endDate);
      const pagesCount = f.pages.length + f._newFiles.length;
      const previewPage = f.pages[0] || null;
      const pendingPage = f._newFiles.find(x => x.index === 0);
      const previewUrl = previewPage || (pendingPage ? URL.createObjectURL(pendingPage.file) : null);
      const pagesLabel = pagesCount > 1 ? `${pagesCount} pages` : '1 page';

      return `
        <div class="flyer-row" data-index="${i}">
          <div class="flyer-row-thumb">
            ${previewUrl
              ? `<img src="${escapeAttr(previewUrl)}" alt="" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'fas fa-file-image\\'></i>';" />`
              : `<i class="fas fa-file-image"></i>`
            }
          </div>
          <div class="flyer-row-info">
            <div class="flyer-row-title">
              ${f.title ? escapeHtml(f.title) : '<span style="color:var(--text-muted);font-style:italic;">Untitled</span>'}
              <span class="flyer-row-pages">${pagesLabel}</span>
            </div>
            <div class="flyer-row-dates">
              ${startStr || endStr
                ? `<i class="fas fa-calendar"></i> ${startStr || '—'} → ${endStr || '—'}`
                : '<span style="color:var(--text-muted);font-style:italic;">No dates set</span>'
              }
            </div>
          </div>
          <div class="flyer-row-actions">
            <button type="button" class="btn-sm btn-edit" data-action="edit" data-index="${i}"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn-sm btn-delete" data-action="delete" data-index="${i}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');

    flyerListEl.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        openFlyerEditor(idx, modal, flyerState, renderFlyerList);
      });
    });

    flyerListEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (!confirm('Delete this flyer? Its images will also be removed when you save.')) return;
        flyerState[idx]._deleteOnSave = true;
        flyerState.splice(idx, 1);
        renderFlyerList();
      });
    });
  }

  renderFlyerList();

  addFlyerBtn.addEventListener('click', () => {
    if (flyerState.length >= MAX_FLYERS) {
      showToast(`Maximum ${MAX_FLYERS} flyers per store. Delete one first.`);
      return;
    }
    const slotId = String(flyerState.length + 1);
    const newFlyer = {
      slotId, title: '', pages: [], startDate: null, endDate: null, uploadedAt: null, _newFiles: []
    };
    flyerState.push(newFlyer);
    renderFlyerList();
    openFlyerEditor(flyerState.length - 1, modal, flyerState, renderFlyerList);
  });

  // ============================================================
  //  SAVE HANDLER
  // ============================================================
  modal.querySelector('#saveStoreBtn').addEventListener('click', async () => {
    const name = document.getElementById('storeName').value.trim();
    const category = document.getElementById('storeCategory').value;
    const address = document.getElementById('storeAddress').value.trim();
    const phone = document.getElementById('storePhone').value.trim();
    const whatsappPrimary = document.getElementById('storeWhatsAppPrimary').value.trim();
    const whatsappSecondary = document.getElementById('storeWhatsAppSecondary').value.trim();
    const logo = document.getElementById('storeLogo').value.trim();
    const description = document.getElementById('storeDescription').value.trim();
    const popular = document.getElementById('storePopular').value === 'true';
    const tags = document.getElementById('storeTags').value.split(',').map(t => t.trim()).filter(Boolean);
    const temporarilyClosed = document.getElementById('storeClosed').value === 'true';

    if (!name || !address || !phone || !whatsappPrimary) {
      showToast('Store name, address, phone, and primary WhatsApp are required.');
      return;
    }

    for (const d of DAYS) {
      const sessions = hoursState[d.key]?.sessions || [];
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const open = normaliseHHMM(s.open);
        const close = normaliseHHMM(s.close);
        if (!open || !close) { showToast(`${d.long}: enter both times for session ${i + 1} (use HH:MM, e.g. 07:30).`); return; }
        if (open >= close) { showToast(`${d.long}: session ${i + 1} closing time must be after opening time.`); return; }
      }
    }

    const seenDates = new Set();
    for (let i = 0; i < overridesState.length; i++) {
      const o = overridesState[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) { showToast(`Override #${i + 1}: date must be YYYY-MM-DD.`); return; }
      if (seenDates.has(o.date)) { showToast(`Override date ${o.date} is listed twice.`); return; }
      seenDates.add(o.date);
      const sessions = o.sessions || [];
      for (let j = 0; j < sessions.length; j++) {
        const s = sessions[j];
        const open = normaliseHHMM(s.open);
        const close = normaliseHHMM(s.close);
        if (!open || !close) { showToast(`${o.date}: enter both times for session ${j + 1}.`); return; }
        if (open >= close) { showToast(`${o.date}: session ${j + 1} closing time must be after opening time.`); return; }
      }
    }

    const finalOpeningHours = normaliseOpeningHours(hoursState);
    const finalOverrides = normaliseOverrides(overridesState);
    const finalLegacyHours = buildLegacyHoursString(finalOpeningHours);

    const saveBtn = modal.querySelector('#saveStoreBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      let storeId = storeData?.id || null;
      if (!storeId) {
        const tempRef = doc(collection(db, 'stores'));
        storeId = tempRef.id;
        storeData = { ...(storeData || {}), id: storeId };
      }

      // ============================================================
      //  GEOCODE ADDRESS
      // ============================================================
      let lat = storeData?.lat || null;
      let lng = storeData?.lng || null;
      
      // If address changed or coords missing, get coords
      if (address !== storeData?.address || typeof lat !== 'number' || typeof lng !== 'number') {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding coordinates...';
        try {
          const geocodeFn = httpsCallable(functions, 'geocodeStoreAddress');
          const geoResult = await geocodeFn({ address });
          if (geoResult.data.success) {
            lat = geoResult.data.lat;
            lng = geoResult.data.lng;
          }
        } catch (err) {
          console.warn('Geocode failed:', err);
          showToast('⚠️ Could not auto-detect coordinates. Store delivery fee might not work until fixed.');
        }
      }

      // ----- FLYERS (upload any pending files) -----
      const flyers = [];
      for (let i = 0; i < flyerState.length; i++) {
        const f = flyerState[i];
        if (f._deleteOnSave) continue;

        const finalPages = [...f.pages];

        if (Array.isArray(f._newFiles)) {
          for (const pf of f._newFiles) {
            try {
              const resized = await resizeImage(pf.file, FLYER_MAX_DIMENSION, FLYER_JPEG_QUALITY, FLYER_MAX_BYTES);
              const path = `stores/${storeId}/flyers/${f.slotId}-${pf.index + 1}.jpg`;
              const url = await uploadImage(path, resized);
              finalPages[pf.index] = url;
            } catch (err) {
              console.warn('Flyer upload failed:', err);
            }
          }
        }

        flyers.push({
          slotId: f.slotId,
          title: f.title || 'Flyer',
          pages: finalPages.filter(Boolean),
          startDate: f.startDate || null,
          endDate: f.endDate || null,
          uploadedAt: f.uploadedAt || new Date(),
          updatedAt: new Date()
        });
      }

      const data = {
        name, category, address, phone, whatsappPrimary,
        whatsappSecondary: whatsappSecondary || '',
        logo: logo || 'img/placeholder.jpg',
        description: description || '',
        openingHours: finalOpeningHours,
        hoursOverrides: finalOverrides,
        hours: finalLegacyHours,          // synced for backwards compat
        popular, tags,
        flyers,
        temporarilyClosed,
        updatedAt: serverTimestamp(),
        lat: lat,
        lng: lng
      };

      if (isEdit) {
        await updateDoc(doc(db, 'stores', storeId), data);
        showToast('✅ Store updated successfully!');
      } else {
        await setDoc(doc(db, 'stores', storeId), { ...data, createdAt: serverTimestamp() });
        showToast('✅ Store added successfully!');
      }
      await bumpCatalogVersion(); // Tell the cache to refresh

      closeModal(modal);
      loadStores();
    } catch (error) {
      console.error('Error saving store:', error);
      showToast('❌ Failed to save store: ' + (error.message || ''));
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Update' : 'Save';
    }
  });
}

// ============================================================
//  FLYER EDITOR — inline modal (unchanged)
// ============================================================
function openFlyerEditor(index, parentModal, flyerState, onDone) {
  const f = flyerState[index];
  if (!f) return;

  const startStr = tsToDateInput(f.startDate);
  const endStr = tsToDateInput(f.endDate);

  const existingPages = f.pages || [];
  const pendingFiles = f._newFiles || [];

  const editor = document.createElement('div');
  editor.className = 'admin-modal active';
  editor.style.zIndex = '1100';
  editor.innerHTML = `
    <div class="modal-content" style="max-width:620px;">
      <div class="modal-header">
        <h3>${f.pages.length || f._newFiles.length ? 'Edit' : 'Add'} Flyer — Slot ${escapeHtml(f.slotId)}</h3>
        <button class="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-body">

        <div class="form-group">
          <label>Title (e.g. Week 1 Specials)</label>
          <input type="text" id="flyerTitle" value="${escapeAttr(f.title || '')}" placeholder="e.g. December Catalogue" />
        </div>

        <div class="flyer-dates-row">
          <div class="form-group">
            <label>Start date *</label>
            <input type="date" id="flyerStartDate" value="${startStr}" />
          </div>
          <div class="form-group">
            <label>End date *</label>
            <input type="date" id="flyerEndDate" value="${endStr}" />
          </div>
        </div>
        <p style="font-size:0.72rem;color:var(--text-muted);margin:-8px 0 12px;">
          Flyer shows to customers only between these dates.
        </p>

        <div class="form-group">
          <label>Pages</label>
          <p class="flyer-pages-hint">
            Upload 1 page for a single flyer, or 2 pages for a 2-page catalog.
          </p>

          <div class="flyer-pages-grid" id="flyerPagesGrid">

            <div class="flyer-page-slot" data-slot="0">
              <div class="flyer-page-preview" id="flyerPreview0">
                ${existingPages[0]
                  ? `<img src="${escapeAttr(existingPages[0])}" alt="" />`
                  : (pendingFiles.find(p => p.index === 0)
                      ? `<img src="${URL.createObjectURL(pendingFiles.find(p => p.index === 0).file)}" alt="" />`
                      : `<i class="fas fa-image"></i>`)}
              </div>
              <input type="file" id="flyerFile0" accept="image/*" hidden />
              <button type="button" class="btn-secondary small" data-choose="0">
                <i class="fas fa-upload"></i> ${existingPages[0] || pendingFiles.find(p => p.index === 0) ? 'Replace Page 1' : 'Upload Page 1'}
              </button>
              ${existingPages[0] || pendingFiles.find(p => p.index === 0) ? `
                <button type="button" class="flyer-page-remove" data-remove="0" title="Remove page 1">
                  <i class="fas fa-times"></i> Remove
                </button>
              ` : ''}
            </div>

            <div class="flyer-page-slot" data-slot="1">
              <div class="flyer-page-preview ${existingPages[1] || pendingFiles.find(p => p.index === 1) ? '' : 'empty'}" id="flyerPreview1">
                ${existingPages[1]
                  ? `<img src="${escapeAttr(existingPages[1])}" alt="" />`
                  : (pendingFiles.find(p => p.index === 1)
                      ? `<img src="${URL.createObjectURL(pendingFiles.find(p => p.index === 1).file)}" alt="" />`
                      : `<span class="flyer-page-empty-label">No second page</span>`)}
              </div>
              <input type="file" id="flyerFile1" accept="image/*" hidden />
              <button type="button" class="btn-secondary small" data-choose="1">
                <i class="fas fa-upload"></i> ${existingPages[1] || pendingFiles.find(p => p.index === 1) ? 'Replace Page 2' : 'Upload Page 2 (optional)'}
              </button>
              ${existingPages[1] || pendingFiles.find(p => p.index === 1) ? `
                <button type="button" class="flyer-page-remove" data-remove="1" title="Remove page 2">
                  <i class="fas fa-times"></i> Remove
                </button>
              ` : ''}
            </div>

          </div>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn-cancel" type="button" data-close-editor>Cancel</button>
        <button class="btn-save" type="button" id="saveFlyerBtn">Save Flyer</button>
      </div>
    </div>
  `;

  document.body.appendChild(editor);

  const close = () => { editor.remove(); };
  editor.querySelector('.modal-close').addEventListener('click', close);
  editor.querySelector('[data-close-editor]').addEventListener('click', close);

  const sessionPages = [...existingPages];
  const sessionPending = [...pendingFiles];

  const renderPreviews = () => {
    [0, 1].forEach(i => {
      const preview = editor.querySelector(`#flyerPreview${i}`);
      const chooseBtn = editor.querySelector(`[data-choose="${i}"]`);
      const removeBtnOld = editor.querySelector(`[data-remove="${i}"]`);
      if (removeBtnOld) removeBtnOld.remove();

      const existing = sessionPages[i];
      const pending = sessionPending.find(p => p.index === i);

      if (existing) {
        preview.innerHTML = `<img src="${escapeAttr(existing)}" alt="" />`;
        preview.classList.remove('empty');
      } else if (pending) {
        preview.innerHTML = `<img src="${URL.createObjectURL(pending.file)}" alt="" />`;
        preview.classList.remove('empty');
      } else if (i === 1) {
        preview.innerHTML = `<span class="flyer-page-empty-label">No second page</span>`;
        preview.classList.add('empty');
      } else {
        preview.innerHTML = `<i class="fas fa-image"></i>`;
      }

      if (i === 0) {
        chooseBtn.innerHTML = `<i class="fas fa-upload"></i> ${existing || pending ? 'Replace Page 1' : 'Upload Page 1'}`;
      } else {
        chooseBtn.innerHTML = `<i class="fas fa-upload"></i> ${existing || pending ? 'Replace Page 2' : 'Upload Page 2 (optional)'}`;
      }

      if (existing || pending) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'flyer-page-remove';
        rm.dataset.remove = String(i);
        rm.title = `Remove page ${i + 1}`;
        rm.innerHTML = `<i class="fas fa-times"></i> Remove`;
        rm.addEventListener('click', () => {
          sessionPages[i] = null;
          const idx = sessionPending.findIndex(p => p.index === i);
          if (idx >= 0) sessionPending.splice(idx, 1);
          renderPreviews();
        });
        chooseBtn.parentElement.appendChild(rm);
      }
    });
  };

  renderPreviews();

  [0, 1].forEach(i => {
    const input = editor.querySelector(`#flyerFile${i}`);
    const chooseBtn = editor.querySelector(`[data-choose="${i}"]`);
    chooseBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      const idx = sessionPending.findIndex(p => p.index === i);
      if (idx >= 0) sessionPending.splice(idx, 1);
      sessionPending.push({ index: i, file });
      renderPreviews();
    });
  });

  editor.querySelector('#saveFlyerBtn').addEventListener('click', () => {
    const title = editor.querySelector('#flyerTitle').value.trim();
    const startVal = editor.querySelector('#flyerStartDate').value;
    const endVal = editor.querySelector('#flyerEndDate').value;

    if (!startVal || !endVal) {
      showToast('Start and end dates are required.');
      return;
    }
    if (new Date(endVal) < new Date(startVal)) {
      showToast('End date must be after start date.');
      return;
    }
    const pages = [
      sessionPages[0] || null,
      sessionPages[1] || null
    ].filter(Boolean);
    if (!pages.length && !sessionPending.length) {
      showToast('Upload at least one page.');
      return;
    }

    flyerState[index] = {
      ...flyerState[index],
      title: title || 'Flyer',
      pages,
      startDate: new Date(startVal + 'T00:00:00'),
      endDate: new Date(endVal + 'T23:59:59'),
      uploadedAt: flyerState[index].uploadedAt || new Date(),
      _newFiles: sessionPending
    };

    editor.remove();
    onDone();
  });
}

// ============================================================
//  EDIT STORE
// ============================================================
export function editStore(storeId) {
  const docRef = doc(db, 'stores', storeId);
  getDoc(docRef).then(docSnap => {
    if (docSnap.exists()) {
      openStoreModal({ ...docSnap.data(), id: storeId });
    } else {
      showToast('Store not found.');
    }
  }).catch(error => {
    console.error('Error loading store:', error);
    showToast('Error loading store.');
  });
}

// ============================================================
//  DELETE STORE
// ============================================================
export async function deleteStore(storeId) {
  if (!confirm('Are you sure you want to delete this store? All products will also be deleted.')) return;
  try {
    const productsQuery = query(collection(db, 'products'), where('storeId', '==', storeId));
    const productsSnap = await getDocs(productsQuery);
    const deletePromises = [];
    productsSnap.forEach(doc => {
      deletePromises.push(deleteDoc(doc.ref));
    });
    await Promise.all(deletePromises);
    await deleteDoc(doc(db, 'stores', storeId));
    await bumpCatalogVersion(); // Tell the cache to refresh
    showToast('✅ Store and all products deleted successfully!');
    loadStores();
  } catch (error) {
    console.error('Error deleting store:', error);
    showToast('❌ Failed to delete store.');
  }
}

// ============================================================
//  IMAGE HELPERS (unchanged)
// ============================================================
function resizeImage(file, maxDim, quality, maxBytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Resize failed'));
            if (blob.size > maxBytes) {
              canvas.toBlob((b2) => b2 ? resolve(b2) : reject(new Error('Retry failed')), 'image/jpeg', 0.72);
            } else {
              resolve(blob);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(path, blob) {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(storageRef);
}

// ============================================================
//  HELPERS
// ============================================================
function tsToMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts._seconds !== undefined) return ts._seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function tsToDateInput(ts) {
  const ms = tsToMillis(ts);
  if (!ms) return '';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
function escapeAttr(str) { return escapeHtml(str); }