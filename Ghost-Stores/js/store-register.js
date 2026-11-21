// js/store-register.js — Owner + Manager registration

import {
  auth, db,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  doc, setDoc, addDoc, collection, getDocs, query, where,
  serverTimestamp
} from './firebase-config.js';

// ---- Tabs ----
const tabs = document.querySelectorAll('.gs-tab');
const ownerForm = document.getElementById('ownerForm');
const managerForm = document.getElementById('managerForm');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    if (tab.dataset.tab === 'owner') {
      ownerForm.style.display = '';
      managerForm.style.display = 'none';
    } else {
      ownerForm.style.display = 'none';
      managerForm.style.display = '';
      loadStoreDirectory();
    }
  });
});

// ---- Store directory (for manager form) ----
let storeDirectoryLoaded = false;
async function loadStoreDirectory() {
  if (storeDirectoryLoaded) return;
  storeDirectoryLoaded = true;

  const select = document.getElementById('managerStore');
  const hint = document.getElementById('managerStoreHint');

  try {
    const q = query(
      collection(db, 'storeApplications'),
      where('status', '==', 'approved')
    );
    const snap = await getDocs(q);

    const stores = [];
    snap.forEach(d => stores.push({ id: d.id, ...d.data() }));

    if (stores.length === 0) {
      select.innerHTML = '<option value="">No approved stores yet</option>';
      hint.textContent = 'No stores are approved yet. Please check back later.';
      return;
    }

    stores.sort((a, b) => (a.storeName || '').localeCompare(b.storeName || ''));

    select.innerHTML =
      '<option value="">Select a store…</option>' +
      stores.map(s => `
        <option value="${escapeAttr(s.uid)}">
          ${escapeHtml(s.storeName || 'Store')} — ${escapeHtml(s.area || '')}
        </option>
      `).join('');
    hint.textContent = `${stores.length} store${stores.length === 1 ? '' : 's'} available.`;
  } catch (err) {
    console.error('loadStoreDirectory error:', err);
    select.innerHTML = '<option value="">Could not load stores</option>';
    hint.textContent = 'Could not load the store list. Please refresh and try again.';
  }
}

// ---- Owner submit ----
ownerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('ownerMessage');
  const btn = ownerForm.querySelector('button[type="submit"]');

  const ownerName = ownerForm.ownerName.value.trim();
  const email = ownerForm.email.value.trim().toLowerCase();
  const phoneLocal = ownerForm.phone.value.replace(/\D/g, '');
  const storeName = ownerForm.storeName.value.trim();
  const area = ownerForm.area.value.trim();
  const password = ownerForm.password.value;

  msg.className = 'gs-message';
  msg.textContent = '';

  if (phoneLocal.length !== 9) {
    msg.className = 'gs-message error';
    msg.textContent = 'Please enter a valid 9-digit mobile number.';
    return;
  }
  if (password.length < 8) {
    msg.className = 'gs-message error';
    msg.textContent = 'Password must be at least 8 characters.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account…';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    await setDoc(doc(db, 'users', uid), {
      role: 'store',
      accountType: 'owner',
      approved: false,
      name: ownerName,
      ownerName: ownerName,
      email: email,
      phone: '+27' + phoneLocal,
      storeName: storeName,
      area: area,
      storeId: null,
      parentOwnerUid: null,
      parentStoreId: null,
      permissions: null,
      suspended: false,
      rejectionReason: null,
      walletBalance: 0,
      emailVerified: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, 'storeApplications', uid), {
      uid: uid,
      email: email,
      ownerName: ownerName,
      phone: '+27' + phoneLocal,
      storeName: storeName,
      area: area,
      status: 'pending',
      approvalStage: 'pending_access',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    try { await sendEmailVerification(cred.user); } catch (err) { console.warn('verify email:', err); }

    msg.className = 'gs-message success';
    msg.innerHTML = '✅ Account created. Check your email to verify your address, then <a href="login.html">sign in</a>.';

    ownerForm.reset();
    setTimeout(() => {
      import('./firebase-config.js').then(m => m.signOut(m.auth)).catch(() => {});
    }, 500);
  } catch (err) {
    console.error('owner register error:', err);
    msg.className = 'gs-message error';
    msg.textContent = friendlyAuthError(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Create owner account';
  }
});

// ---- Manager submit ----
managerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('managerMessage');
  const btn = managerForm.querySelector('button[type="submit"]');

  const name = managerForm.managerName.value.trim();
  const email = managerForm.email.value.trim().toLowerCase();
  const selectedStoreUid = managerForm.storeId.value;
  const password = managerForm.password.value;

  msg.className = 'gs-message';
  msg.textContent = '';

  if (!selectedStoreUid) {
    msg.className = 'gs-message error';
    msg.textContent = 'Please select the store you manage.';
    return;
  }
  if (password.length < 8) {
    msg.className = 'gs-message error';
    msg.textContent = 'Password must be at least 8 characters.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

  try {
    const selectEl = document.getElementById('managerStore');
    const selectedText = selectEl.options[selectEl.selectedIndex].text;
    const targetStoreName = selectedText.split('—')[0].trim();
    const ownerUid = selectedStoreUid;

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    await setDoc(doc(db, 'users', uid), {
      role: 'store',
      accountType: 'manager',
      approved: false,
      name: name,
      email: email,
      storeId: ownerUid,
      parentStoreId: ownerUid,
      parentOwnerUid: ownerUid,
      permissions: null,
      suspended: false,
      rejectionReason: null,
      walletBalance: 0,
      emailVerified: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, 'managerRequests', uid), {
      uid: uid,
      email: email,
      name: name,
      storeId: ownerUid,
      storeName: targetStoreName,
      status: 'pending',
      requestedPermissions: {
        canEditProducts: true,
        canEditFlyers: true,
        canEditHours: true
      },
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    try { await sendEmailVerification(cred.user); } catch (err) { console.warn('verify email:', err); }

    msg.className = 'gs-message success';
    msg.innerHTML = '✅ Request submitted. Verify your email, then <a href="login.html">sign in</a>. The store owner will approve your access.';

    managerForm.reset();
    setTimeout(() => {
      import('./firebase-config.js').then(m => m.signOut(m.auth)).catch(() => {});
    }, 500);
  } catch (err) {
    console.error('manager register error:', err);
    msg.className = 'gs-message error';
    msg.textContent = friendlyAuthError(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Request manager access';
  }
});

// ---- Helpers ----
function friendlyAuthError(err) {
  const code = err?.code || '';
  if (code === 'auth/email-already-in-use') return 'This email is already registered. Try signing in instead.';
  if (code === 'auth/invalid-email') return 'That email address doesn’t look right.';
  if (code === 'auth/weak-password') return 'Password is too weak. Use at least 8 characters.';
  if (code === 'auth/network-request-failed') return 'Network error. Please check your connection.';
  return err?.message || 'Something went wrong. Please try again.';
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }