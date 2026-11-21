// ============================================================
//  hours-utils.js — shared store-hours reader
//
//  Single source of truth for "is this store open right now?"
//  and "what should the badge say?".
//
//  Reads `openingHours` (new structured shape) if present,
//  otherwise falls back to parsing the flat `hours` string
//  (old shape, supports both 24h and am/pm).
//
//  Returns one of:
//    { state: 'open' }
//    { state: 'lunch',  reopenAt: 'HH:MM' }
//    { state: 'closed' }
//
//  Used by index.js, stores.js, store.js, checkout.js.
// ============================================================

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEGACY_DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// ---- public API ------------------------------------------------

/**
 * Main entry. Given a store object (with openingHours and/or hours),
 * return the current open state.
 */
export function getStoreStatus(store) {
  if (!store) return { state: 'closed' };
  if (store.temporarilyClosed === true) return { state: 'closed' };

  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayISO = toISODate(now);

  // Overrides win, if present.
  const overrides = Array.isArray(store.hoursOverrides) ? store.hoursOverrides : [];
  const override = overrides.find(o => o && o.date === todayISO);
  if (override) {
    const sessions = Array.isArray(override.sessions) ? override.sessions : [];
    return evaluateSessions(sessions, nowMins);
  }

  // Structured openingHours.
  if (store.openingHours && typeof store.openingHours === 'object') {
    const day = store.openingHours[dayKey];
    const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
    return evaluateSessions(sessions, nowMins);
  }

  // Legacy flat string.
  const legacy = parseLegacyHours(store.hours || '');
  const sessions = legacy[dayKey] || [];
  return evaluateSessions(sessions, nowMins);
}

/**
 * Returns true if the store is currently orderable.
 * Lunch (between sessions) still counts as orderable.
 */
export function isStoreOpenNow(store) {
  const s = getStoreStatus(store);
  return s.state === 'open' || s.state === 'lunch';
}

/**
 * Human-readable weekly summary, used by the store hero.
 * Returns an array of { day, times, closed } — days in Mon..Sun order.
 */
export function getWeeklyHoursDisplay(store) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const label = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

  let hoursMap = null;
  if (store?.openingHours && typeof store.openingHours === 'object') {
    hoursMap = store.openingHours;
  } else {
    hoursMap = parseLegacyHours(store?.hours || '');
  }

  return order.map(k => {
    const sessions = Array.isArray(hoursMap[k]) ? hoursMap[k] : (hoursMap[k]?.sessions || []);
    if (!sessions.length) return { day: label[k], times: 'Closed', closed: true };
    const times = sessions.map(s => `${s.open} – ${s.close}`).join('  ·  ');
    return { day: label[k], times, closed: false };
  });
}

// ---- internals -------------------------------------------------

function evaluateSessions(sessions, nowMins) {
  if (!sessions.length) return { state: 'closed' };

  // Normalise: sessions may be {open,close} strings in either shape.
  const ranges = sessions
    .map(s => ({
      open: parseHHMM(s?.open),
      close: parseHHMM(s?.close)
    }))
    .filter(r => r.open != null && r.close != null && r.open < r.close)
    .sort((a, b) => a.open - b.open);

  if (!ranges.length) return { state: 'closed' };

  // Currently inside a session?
  for (const r of ranges) {
    if (nowMins >= r.open && nowMins < r.close) {
      return { state: 'open' };
    }
  }

  // Before the first session opens, and it opens today: closed now.
  // Between two sessions with another later today: lunch.
  for (let i = 0; i < ranges.length - 1; i++) {
    const cur = ranges[i];
    const next = ranges[i + 1];
    if (nowMins >= cur.close && nowMins < next.open) {
      return { state: 'lunch', reopenAt: minsToHHMM(next.open) };
    }
  }

  // After the last session closes: closed for the day.
  return { state: 'closed' };
}

// Accepts "07:30", "730", "7:30", "7:30am", "6pm", "18:00" -> minutes
function parseHHMM(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;

  const s = String(v).trim().toLowerCase();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;

  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const period = m[3];
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function minsToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Parse "Mon 07:30-18:00; Tue 07:30-18:00; ..." or
//       "Mon-Fri 7:30am-6pm, Sat 7am-2pm"
// Returns { mon: [{open,close}], tue: [...], ... }
function parseLegacyHours(hoursStr) {
  const out = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  if (!hoursStr || typeof hoursStr !== 'string') return out;

  const lower = hoursStr.toLowerCase();
  if (lower.includes('24/7') || lower.includes('24 hours')) {
    Object.keys(out).forEach(k => { out[k] = [{ open: '00:00', close: '23:59' }]; });
    return out;
  }

  // First try the new "Mon 07:30-12:30 & 13:30-18:00; Tue ..." format.
  if (hoursStr.includes(';')) {
    const parts = hoursStr.split(';').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const sp = part.indexOf(' ');
      if (sp < 0) continue;
      const dayKey = part.slice(0, sp).toLowerCase();
      if (!(dayKey in out)) continue;
      const rest = part.slice(sp + 1).trim();
      if (/^closed$/i.test(rest)) continue;
      const segments = rest.split('&').map(s => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const m = seg.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
        if (!m) continue;
        out[dayKey].push({ open: m[1], close: m[2] });
      }
    }
    return out;
  }

  // Otherwise the old comma format.
  const parts = hoursStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([A-Za-z]{3})(?:\s*-\s*([A-Za-z]{3}))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    if (!m) continue;

    const startKey = capitalise(m[1]);
    const endKey = m[2] ? capitalise(m[2]) : startKey;
    const startIdx = DAY_SHORT.indexOf(startKey);
    const endIdx = DAY_SHORT.indexOf(endKey);
    if (startIdx === -1 || endIdx === -1) continue;

    const openStr = normaliseToHHMM(m[3]);
    const closeStr = normaliseToHHMM(m[4]);
    if (!openStr || !closeStr) continue;

    const indices = [];
    if (startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) indices.push(i);
    } else {
      for (let i = startIdx; i < 7; i++) indices.push(i);
      for (let i = 0; i <= endIdx; i++) indices.push(i);
    }
    indices.forEach(i => {
      const k = DAY_KEYS[i];
      out[k].push({ open: openStr, close: closeStr });
    });
  }
  return out;
}

function capitalise(s) {
  if (!s) return '';
  s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normaliseToHHMM(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const p = m[3].toLowerCase();
  if (p === 'pm' && h < 12) h += 12;
  if (p === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}