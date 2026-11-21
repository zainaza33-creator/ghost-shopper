// js/store-dashboard.js — Role-aware dashboard

import {
  auth, db,
  onAuthStateChanged,
  signOut,
  doc, getDoc, updateDoc
} from './firebase-config.js';
import { startManagerRequestsListener, stopManagerRequestsListener } from './store-manager-requests.js';

const loadingEl = document.getElementById('dashLoading');
const dashApp = document.getElementById('dashApp');
const pendingView = document.getElementById('pendingView');
const approvedTitle = document.getElementById('approvedTitle');
const approvedDesc = document.getElementById('approvedDesc');
const notifBadge = document.getElementById('notifBadge');
const sidebarNotifBtn = document.getElementById('sidebarNotifBtn');
const earningsBox = document.getElementById('earningsBox');
const managerCount = document.getElementById('managerCount');

// Sidebar elements
const sidebar = document.getElementById('dashSidebar');
const overlay = document.getElementById('sidebarOverlay');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobilePageTitle = document.getElementById('mobilePageTitle');

let currentUserProfile = null;

// Global Logout
window.signOutUser = async function() {
  try { stopManagerRequestsListener(); } catch (_) {}
  try { await signOut(auth); } catch (_) {}
  window.location.replace('login.html');
};

// Mobile Sidebar Toggle
function toggleSidebar() {
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
}
if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleSidebar);
if (overlay) overlay.addEventListener('click', toggleSidebar);

// Tab Switching Logic
document.querySelectorAll('.gs-nav-item[data-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    // 1. Update Sidebar active state
    document.querySelectorAll('.gs-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 2. Hide all center views, show target
    document.querySelectorAll('.gs-view').forEach(v => v.classList.remove('active'));
    const targetId = 'view-' + btn.dataset.target;
    const target = document.getElementById(targetId);
    if (target) target.classList.add('active');

    // 3. Update Mobile Header Title
    const label = btn.textContent.trim();
    if (mobilePageTitle) mobilePageTitle.textContent = label;

    // 4. Close sidebar on mobile after clicking
    if (window.innerWidth <= 900) toggleSidebar();
  });
});

// Handle Notification Click
if (sidebarNotifBtn) {
  sidebarNotifBtn.addEventListener('click', () => {
    const managersBtn = document.querySelector('.gs-nav-item[data-target="managers"]');
    if (managersBtn) managersBtn.click();
  });
}

// ---- Auth state ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  if (!user.emailVerified) {
    await signOut(auth);
    window.location.replace('login.html?reason=verify');
    return;
  }

  let profile = null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
      await signOut(auth);
      window.location.replace('login.html?reason=noprofile');
      return;
    }
    profile = snap.data();
  } catch (err) {
    console.error('profile load error:', err);
    return;
  }

  if (profile.role !== 'store') {
    await signOut(auth);
    window.location.replace('login.html?reason=notstore');
    return;
  }

  if (profile.suspended === true) {
    await signOut(auth);
    window.location.replace('login.html?reason=suspended');
    return;
  }

  window.__gsCurrentUid = user.uid;
  currentUserProfile = profile;
  if (loadingEl) loadingEl.style.display = 'none';

  if (profile.approved !== true) {
    if (pendingView) pendingView.style.display = 'flex';
    if (dashApp) dashApp.style.display = 'none';
    const pendingTxt = document.getElementById('pendingText');
    if (pendingTxt) {
      pendingTxt.textContent = profile.accountType === 'owner' 
        ? 'Your owner account is awaiting approval from the Ghost Shopper team.' 
        : 'Your manager request is awaiting approval from the store owner.';
    }
    return;
  }

  // APPROVED VIEW
  if (pendingView) pendingView.style.display = 'none';
  if (dashApp) dashApp.style.display = 'flex';

  if (profile.accountType === 'owner') {
    if (approvedTitle) approvedTitle.textContent = 'Welcome, ' + (profile.name || profile.ownerName || 'Store Owner');
    if (approvedDesc) approvedDesc.textContent = 'Here is an overview of your store today.';
    
    // Show owner-only links & earnings
    document.querySelectorAll('.owner-only').forEach(el => el.style.display = 'flex');
    if (sidebarNotifBtn) sidebarNotifBtn.style.display = 'flex';
    if (earningsBox) earningsBox.style.display = 'flex';

    startManagerRequestsListener(user.uid, (count) => {
      if (notifBadge) {
        if (count > 0) {
          notifBadge.hidden = false;
          notifBadge.textContent = String(count);
        } else {
          notifBadge.hidden = true;
        }
      }
      if (managerCount) managerCount.textContent = String(count); // Update stat tile
    });
    
    loadProfileForm();
    
  } else if (profile.accountType === 'manager') {
    if (approvedTitle) approvedTitle.textContent = 'Welcome, ' + (profile.name || 'Manager');
    if (approvedDesc) approvedDesc.textContent = 'Here is the store status.';
    
    // Hide owner-only links & earnings
    document.querySelectorAll('.owner-only').forEach(el => el.style.display = 'none');
    if (sidebarNotifBtn) sidebarNotifBtn.style.display = 'none';
    if (earningsBox) earningsBox.style.display = 'none';
    if (managerCount) managerCount.parentElement.style.display = 'none'; // Hide manager tile for manager
    
    loadProfileForm();
  }
});

// ---- Load Profile Form ----
function loadProfileForm() {
  if (!currentUserProfile) return;
  const nameEl = document.getElementById('storeName');
  const addrEl = document.getElementById('storeAddress');
  const phoneEl = document.getElementById('storePhone');
  const descEl = document.getElementById('storeDescription');
  
  if (nameEl) nameEl.value = currentUserProfile.storeName || '';
  if (addrEl) addrEl.value = currentUserProfile.address || '';
  if (phoneEl) phoneEl.value = currentUserProfile.phone || '';
  if (descEl) descEl.value = currentUserProfile.description || '';
}

// ---- Image Upload / Compression ----
const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');

if (logoInput) {
  logoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const compressedBase64 = await compressImage(file, 400, 0.7);
      if (logoPreview) logoPreview.innerHTML = `<img src="${compressedBase64}" alt="Logo preview" />`;
      
      if (currentUserProfile && auth.currentUser) {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          logoUrl: compressedBase64
        });
      }
    } catch (err) {
      console.error('Image compression error:', err);
    }
  });
}

function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// Profile form submit
const profileForm = document.getElementById('profileForm');
if (profileForm) {
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        storeName: document.getElementById('storeName').value.trim(),
        address: document.getElementById('storeAddress').value.trim(),
        phone: document.getElementById('storePhone').value.trim(),
        description: document.getElementById('storeDescription').value.trim(),
        updatedAt: new Date()
      });
      
      alert('Profile saved successfully!');
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving profile.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });
}