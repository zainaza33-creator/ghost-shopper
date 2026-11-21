// ============================================================
//  account.js — Ghost Shopper Account page
//  Profile + phone change + addresses (with labels) + wallet
//  + refund + delete. Uses global.js for shared runtime.
// ============================================================

console.log('🚀 account.js booting...');

import { auth, db, storage } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, setDoc, onSnapshot,
  arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";
import {
  signInWithPhoneNumber, RecaptchaVerifier
} from './firebase-config.js';

import {
  showToast,
  updateCartBadge,
  getCart,
  initGlobal,
  openAuthModal,
  subscribeToPush,
  unsubscribeFromPush
} from './global.js';

// ===== Constants =====
const PROFILE_PIC_MAX_BYTES = 200 * 1024;   // 200 KB
const PROFILE_PIC_MAX_DIMENSION = 400;      // px — longest edge after compression
const PROFILE_PIC_JPEG_QUALITY = 0.8;

// ===== DOM =====
const container = document.getElementById('accountContainer');
const loadingScreen = document.getElementById('loadingScreen');

// Edit profile modal
const editProfileModal = document.getElementById('editProfileModal');
const editProfilePicWrapper = document.getElementById('editProfilePicWrapper');
const editProfilePicPreview = document.getElementById('editProfilePicPreview');
const editProfilePicInput = document.getElementById('editProfilePicInput');
const editName = document.getElementById('editName');
const editEmail = document.getElementById('editEmail');
const editPhone = document.getElementById('editPhone');
const editPhoneVerifyBtn = document.getElementById('editPhoneVerifyBtn');
const editPhoneStatus = document.getElementById('editPhoneStatus');
const editOtpSection = document.getElementById('editOtpSection');
const editOtpInput = document.getElementById('editOtpInput');
const editVerifyOtpBtn = document.getElementById('editVerifyOtpBtn');
const editProfileSaveBtn = document.getElementById('editProfileSaveBtn');

// Address modal
const addressModal = document.getElementById('addressModal');
const addressModalTitle = document.getElementById('addressModalTitle');
const addressStreet = document.getElementById('addressStreet');
const addressUnit = document.getElementById('addressUnit');
const addressDefault = document.getElementById('addressDefault');
const addressSuggestionsModal = document.getElementById('addressSuggestionsModal');
const addressModalSaveBtn = document.getElementById('addressModalSaveBtn');

// Wallet
const walletModal = document.getElementById('walletModal');
const walletBalanceDisplay = document.getElementById('walletBalanceDisplay');
const walletRefundBtn = document.getElementById('walletRefundBtn');

// Refund
const refundModal = document.getElementById('refundModal');
const refundAmount = document.getElementById('refundAmount');
const refundSubmitBtn = document.getElementById('refundSubmitBtn');

// Delete
const deleteAccountModal = document.getElementById('deleteAccountModal');
const deleteConfirmInput = document.getElementById('deleteConfirmInput');
const deleteReason = document.getElementById('deleteReason');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

// ===== State =====
let currentUser = null;
let currentUserData = null;

// Phone-change flow state
let newPhoneNumber = null;
let phoneVerificationResult = null;
let phoneVerifier = null;
let isPhoneVerified = false;

// Address edit state
let addressEditIndex = null;
let editingAddressLabel = 'home';
let addressAutocompleteService = null;

// Profile pic pending upload (compressed Blob)
let pendingProfilePicBlob = null;

// ============================================================
//  BOOTSTRAP
// ============================================================
window.addEventListener('load', () => {
  setTimeout(hideLoader, 400);
  setTimeout(hideLoader, 5000);

  try {
    const p = initGlobal();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.warn('initGlobal error (non-fatal):', err));
    }
  } catch (err) {
    console.warn('initGlobal threw (non-fatal):', err);
  }

  updateCartBadge();
  loadUserData();
  initModals();
  initMapsLoader();
});

function hideLoader() {
  if (!loadingScreen) return;
  if (loadingScreen.classList.contains('hidden')) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
}

// ============================================================
//  USER DATA
// ============================================================
function loadUserData() {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      currentUser = null;
      currentUserData = null;
      renderSignInPrompt();
      return;
    }

    currentUser = user;

    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        // Create fresh
        const phone = user.phoneNumber || '';
        await setDoc(userRef, {
          name: '',
          phone: phone,
          email: '',
          role: 'customer',
          savedAddresses: [],
          walletBalance: 0,
          notificationsEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      onSnapshot(userRef, (snap2) => {
        if (snap2.exists()) {
          currentUserData = { id: snap2.id, ...snap2.data() };
          renderAccount();
        }
      });
    } catch (err) {
      console.error('Error loading user data:', err);
      container.innerHTML = `<p style="color:var(--red);text-align:center;padding:2rem 1rem;">Error loading your account. Please refresh.</p>`;
    }
  });
}

function renderSignInPrompt() {
  if (!container) return;
  container.innerHTML = `
    <div class="account-signin-prompt">
      <i class="fas fa-user-lock" aria-hidden="true"></i>
      <h2>Please sign in</h2>
      <p>You need to be signed in to view your account.</p>
      <button class="gs-btn-primary" id="accountSignInBtn" type="button">
        <i class="fas fa-phone-alt" aria-hidden="true"></i>
        <span>Sign In</span>
      </button>
    </div>
  `;
  const btn = document.getElementById('accountSignInBtn');
  if (btn) btn.addEventListener('click', () => openAuthModal());
}

// ============================================================
//  RENDER ACCOUNT
// ============================================================
function renderAccount() {
  if (!currentUserData || !container) return;

  const data = currentUserData;
  const name = data.name || 'Customer';
  const phone = formatPhoneForDisplay(data.phone);
  const email = data.email || 'Not set';
  const role = data.role || 'customer';
  const addresses = data.savedAddresses || [];
  const walletBalance = Number(data.walletBalance || 0);
  const profilePic = data.profilePic || '';
  const notificationsEnabled = data.notificationsEnabled !== false;

  const addressesHtml = addresses.length
    ? addresses.map((addr, i) => renderAddressRow(addr, i)).join('')
    : `<div class="account-empty-line">No saved addresses yet. Add one to speed up checkout.</div>`;

  container.innerHTML = `
    <!-- Profile card -->
    <section class="account-card profile-card">
      <div class="profile-header">
        <button class="profile-pic" id="profilePicBtn" type="button" aria-label="Change profile picture">
          ${profilePic
            ? `<img src="${escapeHtmlAttr(profilePic)}" alt="Profile" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'fas fa-user-circle\\'></i>';" />`
            : `<i class="fas fa-user-circle" aria-hidden="true"></i>`}
          <span class="profile-pic-hint">Tap to change</span>
        </button>
        <div class="profile-name">
          <h2>${escapeHtml(name)}</h2>
          <span class="role-badge ${role}">${role === 'customer' ? 'Customer' : escapeHtml(role)}</span>
        </div>
      </div>

      <div class="profile-details">
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-phone" aria-hidden="true"></i> Phone</span>
          <span class="detail-value">${escapeHtml(phone)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-envelope" aria-hidden="true"></i> Email</span>
          <span class="detail-value">${escapeHtml(email)}</span>
        </div>
        <button class="detail-row wallet-row clickable" id="walletRow" type="button">
          <span class="detail-label"><i class="fas fa-wallet" aria-hidden="true"></i> Wallet</span>
          <span class="detail-value wallet-amount">R${walletBalance.toFixed(2)}</span>
          <i class="fas fa-chevron-right detail-chevron" aria-hidden="true"></i>
        </button>
      </div>

      <div class="profile-actions">
        <button class="action-btn btn-edit-profile" id="editProfileBtn" type="button">
          <i class="fas fa-user-edit" aria-hidden="true"></i> Edit Profile
        </button>
        <a href="my-orders.html" class="action-btn btn-orders">
          <i class="fas fa-truck" aria-hidden="true"></i> My Orders
        </a>
      </div>
    </section>

    <!-- Notifications -->
    <section class="account-card notification-card">
      <div class="section-title">
        <span><i class="fas fa-bell" style="color:var(--orange);" aria-hidden="true"></i> Push Notifications</span>
        <label class="toggle-label" aria-label="Toggle push notifications">
          <input type="checkbox" id="notificationToggle" ${notificationsEnabled ? 'checked' : ''} />
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
        </label>
      </div>
      <div class="notification-info">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        Enable push notifications to receive order updates and promotions.
      </div>
    </section>

    <!-- Addresses -->
    <section class="account-card addresses-section">
      <div class="section-title">
        <span><i class="fas fa-map-pin" aria-hidden="true"></i> Saved Addresses</span>
        <button class="add-address-btn" id="addAddressBtn" type="button">
          <i class="fas fa-plus" aria-hidden="true"></i> Add
        </button>
      </div>
      <div class="address-list" id="addressList">
        ${addressesHtml}
      </div>
    </section>

    <!-- Danger zone -->
    <section class="account-card danger-card">
      <div class="section-title danger-title">
        <span><i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Account Actions</span>
      </div>
      <div class="danger-actions">
        <button class="action-btn btn-delete" id="deleteAccountBtn" type="button">
          <i class="fas fa-trash-alt" aria-hidden="true"></i> Delete Account
        </button>
        <button class="action-btn btn-signout" id="signOutBtn" type="button">
          <i class="fas fa-sign-out-alt" aria-hidden="true"></i> Sign Out
        </button>
      </div>
    </section>
  `;

  wireAccountEvents(addresses);
}

function renderAddressRow(addr, index) {
  const label = addr.label || 'other';
  const labelIcon = labelIconClass(label);
  const labelText = capitalise(label);
  const street = addr.street || '';
  const unit = addr.unit ? `, ${addr.unit}` : '';
  const isDefault = addr.isDefault ? '<span class="default-badge">Default</span>' : '';

  return `
    <div class="address-item" data-index="${index}">
      <div class="address-item-icon">
        <i class="${labelIcon}" aria-hidden="true"></i>
      </div>
      <div class="address-text">
        <span class="address-label-text">${escapeHtml(labelText)}</span>
        <strong>${escapeHtml(street)}${escapeHtml(unit)}</strong>
        ${isDefault}
      </div>
      <div class="address-actions">
        <button class="edit-btn" data-index="${index}" aria-label="Edit address" type="button">
          <i class="fas fa-pen" aria-hidden="true"></i>
        </button>
        <button class="delete-btn" data-index="${index}" aria-label="Delete address" type="button">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function wireAccountEvents(addresses) {
  // Profile pic button
  document.getElementById('profilePicBtn')?.addEventListener('click', () => {
    openEditProfileModal();
    setTimeout(() => editProfilePicInput?.click(), 350);
  });

  // Edit profile
  document.getElementById('editProfileBtn')?.addEventListener('click', openEditProfileModal);

  // Wallet
  document.getElementById('walletRow')?.addEventListener('click', openWalletModal);

  // Sign out
  document.getElementById('signOutBtn')?.addEventListener('click', async () => {
    try {
      await auth.signOut();
      window.location.href = 'index.html';
    } catch (err) {
      console.error('Sign out error:', err);
      showToast('Could not sign out. Please try again.');
    }
  });

  // Delete account
  document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
    openModal(deleteAccountModal);
  });

  // Add address
  document.getElementById('addAddressBtn')?.addEventListener('click', () => {
    openAddressModal();
  });

  // Edit address
  document.querySelectorAll('.address-item .edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index, 10);
      openAddressModal(addresses[index], index);
    });
  });

  // Delete address
  document.querySelectorAll('.address-item .delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index, 10);
      const addr = addresses[index];
      if (!addr) return;
      if (!confirm('Remove this address?')) return;

      try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, { savedAddresses: arrayRemove(addr) });
        showToast('Address removed.');
      } catch (err) {
        console.error('Error removing address:', err);
        showToast('Could not remove address.');
      }
    });
  });

  // Notifications toggle
  const toggle = document.getElementById('notificationToggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
          notificationsEnabled: enabled,
          updatedAt: new Date()
        });
        if (enabled) {
          await subscribeToPush();
          showToast('Notifications enabled.');
        } else {
          await unsubscribeFromPush();
          showToast('Notifications disabled.');
        }
      } catch (err) {
        console.error('Error toggling notifications:', err);
        showToast('Could not update notification setting.');
        e.target.checked = !enabled;
      }
    });
  }
}

// ============================================================
//  MODALS — shared open/close helpers
// ============================================================
function openModal(el) {
  if (!el) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeModal(el) {
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => {
    el.hidden = true;
    document.body.style.overflow = '';
  }, 220);
}

function initModals() {
  // Data-close handlers for every modal
  document.querySelectorAll('[data-edit-profile-close]').forEach(el =>
    el.addEventListener('click', () => closeModal(editProfileModal)));
  document.querySelectorAll('[data-address-close]').forEach(el =>
    el.addEventListener('click', () => closeModal(addressModal)));
  document.querySelectorAll('[data-wallet-close]').forEach(el =>
    el.addEventListener('click', () => closeModal(walletModal)));
  document.querySelectorAll('[data-refund-close]').forEach(el =>
    el.addEventListener('click', () => closeModal(refundModal)));
  document.querySelectorAll('[data-delete-close]').forEach(el =>
    el.addEventListener('click', () => closeModal(deleteAccountModal)));

  // Escape closes the top-most open modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.gs-modal.open');
    if (open) closeModal(open);
  });

  // Edit profile — pic input
  if (editProfilePicWrapper && editProfilePicInput) {
    editProfilePicWrapper.addEventListener('click', () => editProfilePicInput.click());
    editProfilePicInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleProfilePicSelection(file);
      editProfilePicInput.value = '';
    });
  }

  // Edit profile — save
  if (editProfileSaveBtn) {
    editProfileSaveBtn.addEventListener('click', saveProfileChanges);
  }

  // Edit profile — phone verify
  if (editPhoneVerifyBtn) {
    editPhoneVerifyBtn.addEventListener('click', sendPhoneVerifyCode);
  }

  // Edit profile — OTP verify
  if (editVerifyOtpBtn) {
    editVerifyOtpBtn.addEventListener('click', verifyPhoneOtp);
  }

  // Address modal — save
  if (addressModalSaveBtn) {
    addressModalSaveBtn.addEventListener('click', saveAddress);
  }

  // Address modal — label chips
  document.querySelectorAll('.address-label-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.address-label-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      editingAddressLabel = chip.dataset.label || 'other';
    });
  });

  // Wallet — refund button opens refund modal
  if (walletRefundBtn) {
    walletRefundBtn.addEventListener('click', () => {
      closeModal(walletModal);
      setTimeout(() => {
        if (refundAmount) refundAmount.value = (currentUserData?.walletBalance || 0).toFixed(2);
        openModal(refundModal);
      }, 260);
    });
  }

  // Refund — submit
  if (refundSubmitBtn) {
    refundSubmitBtn.addEventListener('click', submitRefundRequest);
  }

  // Delete — confirm input enable
  if (deleteConfirmInput && deleteConfirmBtn) {
    deleteConfirmInput.addEventListener('input', () => {
      deleteConfirmBtn.disabled = deleteConfirmInput.value.trim() !== 'DELETE';
    });
  }

  // Delete — confirm button
  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener('click', confirmDeleteAccount);
  }
}

// ============================================================
//  EDIT PROFILE — open/save
// ============================================================
function openEditProfileModal() {
  if (!currentUserData) return;

  if (editName) editName.value = currentUserData.name || '';
  if (editEmail) editEmail.value = currentUserData.email || '';

  const storedPhone = currentUserData.phone || '';
  const localDigits = phoneToLocalDigits(storedPhone);
  if (editPhone) editPhone.value = localDigits;

    if (editPhoneStatus) {
    editPhoneStatus.textContent = storedPhone
      ? `Current phone: ${formatPhoneForDisplay(storedPhone)}`
      : 'Enter 9 digits — the +27 prefix is set.';
    editPhoneStatus.style.color = '';
  }

  if (editOtpSection) editOtpSection.hidden = true;
  if (editOtpInput) editOtpInput.value = '';

  if (editProfilePicPreview) {
    if (currentUserData.profilePic) {
      editProfilePicPreview.src = currentUserData.profilePic;
      editProfilePicPreview.style.display = 'block';
    } else {
      editProfilePicPreview.removeAttribute('src');
      editProfilePicPreview.style.display = 'none';
    }
  }

  pendingProfilePicBlob = null;
  isPhoneVerified = false;
  newPhoneNumber = null;
  phoneVerificationResult = null;

  openModal(editProfileModal);
}

async function saveProfileChanges() {
  if (!currentUser) return;

  const newName = (editName?.value || '').trim();
  const newEmail = (editEmail?.value || '').trim();
  const rawPhone = (editPhone?.value || '').trim();
  const localDigits = rawPhone.replace(/\D/g, '').slice(0, 9);
  // Validate phone if changed
  const currentDigits = phoneToLocalDigits(currentUserData.phone || '');
  const phoneChanged = localDigits && localDigits !== currentDigits;

  if (phoneChanged && !isPhoneVerified) {
    showToast('Please verify your new phone number first.');
    return;
  }

  const updates = {
    name: newName,
    email: newEmail,
    updatedAt: new Date()
  };

  if (phoneChanged) {
    updates.phone = '+27' + localDigits;
  }

  editProfileSaveBtn.disabled = true;
  editProfileSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    // Upload picture if pending
    if (pendingProfilePicBlob) {
      try {
        const storageRef = ref(storage, `profile_pics/${currentUser.uid}`);
        await uploadBytes(storageRef, pendingProfilePicBlob, { contentType: 'image/jpeg' });
        const url = await getDownloadURL(storageRef);
        updates.profilePic = url;
      } catch (err) {
        console.error('Profile pic upload failed:', err);
        showToast('Profile picture upload failed. Other changes saved.');
      }
    }

    await updateDoc(doc(db, 'users', currentUser.uid), updates);
    closeModal(editProfileModal);

    if (phoneChanged) {
      showToast('Phone number updated. Signing you out...');
      setTimeout(async () => {
        await auth.signOut();
        window.location.href = 'index.html';
      }, 1800);
      return;
    }

    showToast('Profile updated.');
  } catch (err) {
    console.error('Error saving profile:', err);
    showToast('Could not save changes.');
  } finally {
    editProfileSaveBtn.disabled = false;
    editProfileSaveBtn.textContent = 'Save Changes';
    pendingProfilePicBlob = null;
  }
}

// ---- Phone verification ----
async function sendPhoneVerifyCode() {
  if (!editPhone) return;
  const digits = (editPhone.value || '').replace(/\D/g, '');

  if (digits.length !== 9) {
    showToast('Enter a 9-digit mobile number.');
    return;
  }

  const formatted = '+27' + digits;
  if (formatted === (currentUserData.phone || '')) {
    showToast('This is your current phone number.');
    return;
  }

  newPhoneNumber = formatted;
  editPhoneVerifyBtn.disabled = true;
  editPhoneVerifyBtn.textContent = 'Sending...';

  try {
    if (phoneVerifier) {
      try { phoneVerifier.clear(); } catch (_) {}
      phoneVerifier = null;
    }

    const container = document.createElement('div');
    container.id = 'edit-phone-recaptcha';
    container.style.display = 'none';
    document.body.appendChild(container);

    phoneVerifier = new RecaptchaVerifier(auth, container, {
      size: 'invisible',
      callback: () => {}
    });

    phoneVerificationResult = await signInWithPhoneNumber(auth, formatted, phoneVerifier);

    if (editOtpSection) editOtpSection.hidden = false;
    if (editPhoneStatus) {
      editPhoneStatus.textContent = 'Code sent. Enter it above to verify.';
      editPhoneStatus.style.color = 'var(--green)';
    }
    if (editOtpInput) editOtpInput.focus();
    showToast('Verification code sent.');
  } catch (err) {
    console.error('Error sending verification:', err);
    showToast('Could not send verification code.');
    if (editPhoneStatus) {
      editPhoneStatus.textContent = 'Could not send code. Try again.';
      editPhoneStatus.style.color = 'var(--red)';
    }
    phoneVerifier = null;
  } finally {
    editPhoneVerifyBtn.disabled = false;
    editPhoneVerifyBtn.textContent = 'Verify';
  }
}

async function verifyPhoneOtp() {
  if (!editOtpInput) return;
  const code = (editOtpInput.value || '').trim();

  if (code.length !== 6) {
    showToast('Enter the 6-digit code.');
    return;
  }
  if (!phoneVerificationResult) {
    showToast('Please request a code first.');
    return;
  }

  editVerifyOtpBtn.disabled = true;
  editVerifyOtpBtn.textContent = 'Verifying...';

  try {
    await phoneVerificationResult.confirm(code);
    isPhoneVerified = true;
    if (editPhoneStatus) {
      editPhoneStatus.textContent = 'Phone verified. Save to apply.';
      editPhoneStatus.style.color = 'var(--green)';
    }
    showToast('Phone verified.');
  } catch (err) {
    console.error('OTP confirm error:', err);
    showToast('Invalid or expired code.');
    if (editPhoneStatus) {
      editPhoneStatus.textContent = 'Invalid code. Try again.';
      editPhoneStatus.style.color = 'var(--red)';
    }
  } finally {
    editVerifyOtpBtn.disabled = false;
    editVerifyOtpBtn.textContent = 'Verify Code';
  }
}

// ---- Profile picture handling ----
async function handleProfilePicSelection(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file.');
    return;
  }

  try {
    showToast('Optimising picture...');
    const blob = await compressImage(file);

    if (blob.size > PROFILE_PIC_MAX_BYTES) {
      showToast('Picture too large after compression. Try a smaller image.');
      return;
    }

    pendingProfilePicBlob = blob;

    const reader = new FileReader();
    reader.onload = (e) => {
      if (editProfilePicPreview) {
        editProfilePicPreview.src = e.target.result;
        editProfilePicPreview.style.display = 'block';
      }
    };
    reader.readAsDataURL(blob);
    showToast('Picture ready. Save to apply.');
  } catch (err) {
    console.error('Error processing image:', err);
    showToast('Could not process image.');
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Scale down so longest edge is PROFILE_PIC_MAX_DIMENSION
        if (width > height && width > PROFILE_PIC_MAX_DIMENSION) {
          height = Math.round(height * (PROFILE_PIC_MAX_DIMENSION / width));
          width = PROFILE_PIC_MAX_DIMENSION;
        } else if (height > PROFILE_PIC_MAX_DIMENSION) {
          width = Math.round(width * (PROFILE_PIC_MAX_DIMENSION / height));
          height = PROFILE_PIC_MAX_DIMENSION;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Try quality 0.8 first
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Canvas toBlob failed'));
            // If still too big, retry at 0.6
            if (blob.size > PROFILE_PIC_MAX_BYTES) {
              canvas.toBlob(
                (blob2) => {
                  if (!blob2) return reject(new Error('Canvas toBlob failed (retry)'));
                  resolve(blob2);
                },
                'image/jpeg',
                0.6
              );
            } else {
              resolve(blob);
            }
          },
          'image/jpeg',
          PROFILE_PIC_JPEG_QUALITY
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ============================================================
//  ADDRESSES
// ============================================================
function initMapsLoader() {
  // Maps is loaded dynamically in account.html.
  // Poll until it's ready, then set up the autocomplete service.
  const check = () => {
    if (window.google && google.maps && google.maps.places) {
      if (!addressAutocompleteService) {
        try {
          addressAutocompleteService = new google.maps.places.AutocompleteService();
        } catch (e) {
          console.warn('Autocomplete init failed:', e);
        }
      }
      return;
    }
    setTimeout(check, 500);
  };
  setTimeout(check, 500);
}

function openAddressModal(addressData = null, editIndex = null) {
  if (!addressModal) return;

  addressEditIndex = editIndex;
  editingAddressLabel = addressData?.label || 'home';

  if (addressModalTitle) {
    addressModalTitle.innerHTML = editIndex !== null
      ? '<i class="fas fa-pen" aria-hidden="true"></i> Edit Address'
      : '<i class="fas fa-map-pin" aria-hidden="true"></i> Add New Address';
  }

  if (addressStreet) addressStreet.value = addressData?.street || '';
  if (addressUnit) addressUnit.value = addressData?.unit || '';
  if (addressDefault) addressDefault.value = addressData?.isDefault ? 'true' : 'false';

  document.querySelectorAll('.address-label-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.label === editingAddressLabel);
  });

  openModal(addressModal);

  setTimeout(() => {
    setupAddressStreetAutocomplete();
  }, 200);
}

function setupAddressStreetAutocomplete() {
  if (!addressStreet || !addressSuggestionsModal) return;

  // Remove old listeners by cloning
  const fresh = addressStreet.cloneNode(true);
  addressStreet.parentNode.replaceChild(fresh, addressStreet);
  const input = document.getElementById('addressStreet');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 3 || !addressAutocompleteService) {
      addressSuggestionsModal.innerHTML = '';
      addressSuggestionsModal.classList.remove('active');
      return;
    }

    addressAutocompleteService.getPlacePredictions(
      { input: q, componentRestrictions: { country: 'za' } },
      (predictions, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) {
          addressSuggestionsModal.innerHTML = '';
          addressSuggestionsModal.classList.remove('active');
          return;
        }
        addressSuggestionsModal.innerHTML = predictions.map(p => `
          <div class="suggestion-item" data-desc="${escapeHtmlAttr(p.description)}">
            ${escapeHtml(p.description)}
          </div>
        `).join('');
        addressSuggestionsModal.classList.add('active');

        addressSuggestionsModal.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.desc;
            addressSuggestionsModal.innerHTML = '';
            addressSuggestionsModal.classList.remove('active');
          });
        });
      }
    );
  });

  document.addEventListener('click', (e) => {
    if (addressSuggestionsModal && !addressSuggestionsModal.contains(e.target) && e.target !== input) {
      addressSuggestionsModal.classList.remove('active');
    }
  });
}

async function saveAddress() {
  if (!currentUser || !currentUserData) return;

  const street = (addressStreet?.value || '').trim();
  const unit = (addressUnit?.value || '').trim();
  const isDefault = (addressDefault?.value || 'false') === 'true';

  if (!street) {
    showToast('Please enter a street address.');
    return;
  }

  const label = editingAddressLabel || 'other';
  const currentList = Array.isArray(currentUserData.savedAddresses)
    ? [...currentUserData.savedAddresses]
    : [];

  addressModalSaveBtn.disabled = true;
  addressModalSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    // If editing, remove old
    if (addressEditIndex !== null && currentList[addressEditIndex]) {
      const old = currentList[addressEditIndex];
      await updateDoc(doc(db, 'users', currentUser.uid), {
        savedAddresses: arrayRemove(old)
      });
    }

    const newAddress = {
      street,
      unit,
      label,
      isDefault,
      savedAt: new Date().toISOString()
    };

    // If new address is default, clear others' default flag
    if (isDefault) {
      const cleared = currentList.map(a => ({ ...a, isDefault: false }));
      await updateDoc(doc(db, 'users', currentUser.uid), { savedAddresses: cleared });
    }

    await updateDoc(doc(db, 'users', currentUser.uid), {
      savedAddresses: arrayUnion(newAddress),
      updatedAt: new Date()
    });

    showToast(addressEditIndex !== null ? 'Address updated.' : 'Address added.');
    closeModal(addressModal);
  } catch (err) {
    console.error('Error saving address:', err);
    showToast('Could not save address.');
  } finally {
    addressModalSaveBtn.disabled = false;
    addressModalSaveBtn.textContent = 'Save Address';
    addressEditIndex = null;
  }
}

// ============================================================
//  WALLET + REFUND
// ============================================================
function openWalletModal() {
  if (!currentUserData) return;
  const balance = Number(currentUserData.walletBalance || 0);
  if (walletBalanceDisplay) walletBalanceDisplay.textContent = `R${balance.toFixed(2)}`;
  openModal(walletModal);
}

async function submitRefundRequest() {
  if (!currentUser || !currentUserData) return;

  const amount = parseFloat(refundAmount?.value || '0');
  const balance = Number(currentUserData.walletBalance || 0);

  if (!amount || amount <= 0) {
    showToast('Enter a valid amount.');
    return;
  }
  if (amount > balance) {
    showToast('Amount exceeds wallet balance.');
    return;
  }

  refundSubmitBtn.disabled = true;
  refundSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

  try {
    const id = currentUser.uid + '_' + Date.now();
    await setDoc(doc(db, 'refundRequests', id), {
      userId: currentUser.uid,
      userName: currentUserData.name || 'User',
      userPhone: currentUserData.phone || '',
      amount,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      message: `Refund request for R${amount.toFixed(2)}`
    });

    showToast('Refund request submitted. Processing takes 3–7 working days.');
    closeModal(refundModal);
  } catch (err) {
    console.error('Error submitting refund:', err);
    showToast('Could not submit refund request.');
  } finally {
    refundSubmitBtn.disabled = false;
    refundSubmitBtn.textContent = 'Request Refund';
  }
}

// ============================================================
//  DELETE ACCOUNT (soft — Firestore only)
// ============================================================
async function confirmDeleteAccount() {
  if (!currentUser) return;

  const reason = (deleteReason?.value || '').trim() || 'No reason provided';

  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

  try {
    // Best-effort: remove profile picture from storage
    try {
      const storageRef = ref(storage, `profile_pics/${currentUser.uid}`);
      await deleteObject(storageRef);
    } catch (_) { /* ignore */ }

    // Soft delete Firestore record
    await updateDoc(doc(db, 'users', currentUser.uid), {
      deleted: true,
      deletedAt: new Date(),
      deletionReason: reason,
      name: '',
      email: '',
      phone: '',
      savedAddresses: [],
      walletBalance: 0,
      profilePic: '',
      notificationsEnabled: false,
      updatedAt: new Date()
    });

    // Sign out locally
    await auth.signOut();
    showToast('Account deleted. Redirecting...');
    setTimeout(() => { window.location.href = 'index.html'; }, 1200);
  } catch (err) {
    console.error('Error deleting account:', err);
    showToast('Could not delete account. Please try again.');
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = 'Delete Account';
  }
}

// ============================================================
//  HELPERS
// ============================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(str) { return escapeHtml(str); }

function formatPhoneForDisplay(raw) {
  // Prefer global helper if available (loaded from global.js)
  if (typeof window.gsFormatPhone === 'function') {
    return window.gsFormatPhone(raw);
  }
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (digits.length !== 9) return '+27 ' + digits;
  return `+27 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

function phoneToLocalDigits(raw) {
  if (typeof window.gsPhoneToLocal === 'function') {
    return window.gsPhoneToLocal(raw);
  }
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function labelIconClass(label) {
  if (label === 'home') return 'fas fa-home';
  if (label === 'work') return 'fas fa-briefcase';
  return 'fas fa-map-pin';
}

window.openNotificationModal = function () {
  showToast('No new alerts right now.');
};