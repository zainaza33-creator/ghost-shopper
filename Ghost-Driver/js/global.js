// ============================================================
//  GLOBAL.JS - Shared functions for all pages
//  Import this in every page BEFORE page-specific JS
// ============================================================

import {
  auth,
  db,
  signInWithPhoneNumber,
  RecaptchaVerifier
} from './firebase-config.js';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ===== FCM IMPORTS =====
import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js";

// ===== IMPORT CART UTILITIES =====
import {
  updateCartBadge as updateBadge,
  getCart as getCartUtil,
  saveCart as saveCartUtil,
  clearCart as clearCartUtil,
  getCartTotal as getCartTotalUtil,
  getCartItemCount as getCartItemCountUtil,
  getActivePrice
} from './cart-utils.js';

// ============================================================
//  CART EXPORTS
// ============================================================
export const updateCartBadge = updateBadge;
export const getCart = getCartUtil;
export const saveCart = saveCartUtil;
export const clearCart = clearCartUtil;
export const getCartTotal = getCartTotalUtil;
export const getCartItemCount = getCartItemCountUtil;

// ============================================================
//  ADDRESS FUNCTIONS
// ============================================================
const ADDRESS_KEY = 'ghostShopperAddress';

export function getSavedAddress() {
  return localStorage.getItem(ADDRESS_KEY) || '';
}

export function saveAddress(address) {
  if (!address || !address.trim()) {
    localStorage.removeItem(ADDRESS_KEY);
    updateAddressInputs('');
    return true;
  }
  localStorage.setItem(ADDRESS_KEY, address.trim());
  updateAddressInputs(address.trim());
  return true;
}

export function updateAddressInputs(address) {
  const desktopInput = document.getElementById('addressSearchInput');
  if (desktopInput) desktopInput.value = address;

  const mobileInput = document.getElementById('mobileAddressInput');
  if (mobileInput) {
    mobileInput.value = address;
    mobileInput.placeholder = address || 'Enter delivery address...';
  }

  const toggleSpan = document.querySelector('.mobile-address-toggle span');
  if (toggleSpan) {
    if (address && address.trim()) {
      toggleSpan.textContent = address.length > 20 ? address.substring(0, 20) + '...' : address;
    } else {
      toggleSpan.textContent = 'Enter delivery address';
    }
  }
}

// ============================================================
//  ADDRESS SEARCH INIT
// ============================================================
let addressAutocompleteService = null;
let addressSearchInitialized = false;

export function initAddressSearch() {
  if (addressSearchInitialized) {
    console.log('✅ Address search already initialized');
    return;
  }

  if (!window.google || !google.maps || !google.maps.places) {
    console.log('⏳ Google Maps not loaded yet, waiting...');
    setTimeout(() => {
      if (window.google && google.maps && google.maps.places) {
        initAddressSearch();
      } else {
        console.log('⏳ Still waiting for Google Maps...');
        setTimeout(() => {
          if (window.google && google.maps && google.maps.places) {
            initAddressSearch();
          } else {
            console.warn('⚠️ Google Maps failed to load. Address search disabled.');
          }
        }, 2000);
      }
    }, 1000);
    return;
  }

  console.log('✅ Initializing address search...');

  try {
    addressAutocompleteService = new google.maps.places.AutocompleteService();
  } catch (e) {
    console.warn('⚠️ Could not create AutocompleteService:', e);
    return;
  }

  const addressInput = document.getElementById('addressSearchInput');
  const mobileInput = document.getElementById('mobileAddressInput');
  const suggestions = document.getElementById('addressSuggestions');
  const mobileSuggestions = document.getElementById('mobileAddressSuggestions');
  const mobileToggle = document.getElementById('mobileAddressToggle');
  const mobileDropdown = document.getElementById('mobileAddressDropdown');
  const mobileClose = document.getElementById('mobileAddressClose');

  if (!addressInput) {
    addressSearchInitialized = true;
    return;
  }

  const savedAddress = getSavedAddress();
  if (savedAddress) {
    addressInput.value = savedAddress;
    if (mobileInput) mobileInput.value = savedAddress;
  }

  const newAddressInput = addressInput.cloneNode(true);
  addressInput.parentNode.replaceChild(newAddressInput, addressInput);
  const finalAddressInput = document.getElementById('addressSearchInput');

  finalAddressInput.addEventListener('input', function(e) {
    const query = e.target.value;
    if (query.length > 2) {
      saveAddress(query);
    }
    handleAddressInput(query);
  });

  finalAddressInput.addEventListener('focus', function() {
    if (this.value.length > 2) {
      handleAddressInput(this.value);
    }
  });

  if (mobileInput) {
    const newMobileInput = mobileInput.cloneNode(true);
    mobileInput.parentNode.replaceChild(newMobileInput, mobileInput);
    const finalMobileInput = document.getElementById('mobileAddressInput');

    finalMobileInput.addEventListener('input', function(e) {
      const val = e.target.value;
      const desktopInput = document.getElementById('addressSearchInput');
      if (desktopInput) desktopInput.value = val;
      if (val.length > 2) {
        saveAddress(val);
      }
      handleAddressInput(val);

      setTimeout(() => {
        const desktopSuggestions = document.getElementById('addressSuggestions');
        const mobileSuggestionsEl = document.getElementById('mobileAddressSuggestions');
        if (desktopSuggestions && mobileSuggestionsEl) {
          mobileSuggestionsEl.innerHTML = desktopSuggestions.innerHTML;
          mobileSuggestionsEl.style.display = desktopSuggestions.classList.contains('active') ? 'block' : 'none';
        }
      }, 100);
    });
  }

  if (mobileToggle) {
    mobileToggle.addEventListener('click', function() {
      if (mobileDropdown) {
        mobileDropdown.classList.add('active');
        if (document.getElementById('mobileAddressInput')) {
          document.getElementById('mobileAddressInput').focus();
        }
      }
    });
  }

  if (mobileClose) {
    mobileClose.addEventListener('click', function() {
      if (mobileDropdown) mobileDropdown.classList.remove('active');
    });
  }

  document.addEventListener('click', function(e) {
    if (mobileDropdown && mobileDropdown.classList.contains('active')) {
      if (!mobileDropdown.contains(e.target) && e.target !== mobileToggle) {
        mobileDropdown.classList.remove('active');
      }
    }
  });

  document.addEventListener('click', function(e) {
    if (suggestions && suggestions.classList.contains('active')) {
      if (!suggestions.contains(e.target) && e.target !== finalAddressInput) {
        suggestions.classList.remove('active');
      }
    }
  });

  document.addEventListener('click', function(e) {
    const suggestion = e.target.closest('.suggestion-item');
    if (suggestion) {
      const description = suggestion.dataset.description;
      const desktopInput = document.getElementById('addressSearchInput');
      const mobileInputEl = document.getElementById('mobileAddressInput');
      const suggestionsEl = document.getElementById('addressSuggestions');
      const mobileSuggestionsEl = document.getElementById('mobileAddressSuggestions');
      const dropdown = document.getElementById('mobileAddressDropdown');

      if (desktopInput) desktopInput.value = description;
      if (mobileInputEl) mobileInputEl.value = description;
      saveAddress(description);
      if (suggestionsEl) suggestionsEl.classList.remove('active');
      if (mobileSuggestionsEl) {
        mobileSuggestionsEl.innerHTML = '';
        mobileSuggestionsEl.style.display = 'none';
      }
      if (dropdown) dropdown.classList.remove('active');

      const isVerulam = description.toLowerCase().includes('verulam');
      showToast(isVerulam ? '✅ We deliver to this area!' : '🚧 This area is coming soon!');
    }
  });

  addressSearchInitialized = true;
  console.log('✅ Address search initialized successfully');
}

function handleAddressInput(query) {
  const suggestions = document.getElementById('addressSuggestions');
  const mobileSuggestions = document.getElementById('mobileAddressSuggestions');

  if (!query || query.length < 3) {
    if (suggestions) suggestions.classList.remove('active');
    if (mobileSuggestions) {
      mobileSuggestions.innerHTML = '';
      mobileSuggestions.style.display = 'none';
    }
    if (query === '') {
      localStorage.removeItem(ADDRESS_KEY);
      updateAddressInputs('');
    }
    return;
  }

  if (!addressAutocompleteService) return;

  addressAutocompleteService.getPlacePredictions({
    input: query,
    componentRestrictions: { country: 'za' }
  }, function(predictions, status) {
    if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
      if (suggestions) suggestions.classList.remove('active');
      if (mobileSuggestions) {
        mobileSuggestions.innerHTML = '';
        mobileSuggestions.style.display = 'none';
      }
      return;
    }

    const html = predictions.map(function(prediction) {
      const isVerulam = prediction.description.toLowerCase().includes('verulam');
      const statusText = isVerulam ? '✅ Available' : '🚧 Coming soon';
      const statusClass = isVerulam ? 'available' : 'unavailable';

      return `
        <div class="suggestion-item" data-place-id="${prediction.place_id}" data-description="${prediction.description}">
          <strong>${prediction.description}</strong>
          <span class="delivery-status ${statusClass}">${statusText}</span>
          <span class="suggestion-area">${isVerulam ? '<i class="fas fa-check-circle"></i> We deliver here!' : '<i class="fas fa-clock"></i> Coming soon to this area'}</span>
        </div>
      `;
    }).join('');

    const fallbackHtml = html + `
      <div class="suggestion-item manual-entry" data-description="${query}">
        <i class="fas fa-pen"></i> Use "${query}" as delivery address
      </div>
    `;

    if (suggestions) {
      suggestions.innerHTML = fallbackHtml;
      suggestions.classList.add('active');
    }
    if (mobileSuggestions) {
      mobileSuggestions.innerHTML = fallbackHtml;
      mobileSuggestions.style.display = 'block';
    }
  });
}

// ============================================================
//  NOTIFICATION FUNCTIONS
// ============================================================
const NOTIFICATION_KEY = 'ghostShopperNotifications';

export function getUnreadNotificationCount() {
  try {
    const notifications = JSON.parse(localStorage.getItem(NOTIFICATION_KEY)) || [];
    return notifications.filter(n => !n.read).length;
  } catch {
    return 0;
  }
}

export function updateNotificationBadge() {
  const count = getUnreadNotificationCount();
  const desktopBadge = document.getElementById('desktop-notif-count');
  const mobileBadge = document.getElementById('bottom-notif-count');

  if (desktopBadge) {
    if (count > 0) {
      desktopBadge.textContent = count > 9 ? '9+' : count;
      desktopBadge.classList.add('show');
    } else {
      desktopBadge.classList.remove('show');
    }
  }

  if (mobileBadge) {
    if (count > 0) {
      mobileBadge.textContent = count > 9 ? '9+' : count;
      mobileBadge.classList.add('show');
    } else {
      mobileBadge.classList.remove('show');
    }
  }
}

// [ADDED] Refresh the header bell badge from Firestore. Called on
// page load and whenever auth state changes. This is what makes the
// bell turn from grey to orange when unread notifications exist.
export async function refreshHeaderNotifBadge() {
  const user = auth.currentUser;
  const desktopBadge = document.getElementById('desktop-notif-count');
  const mobileBadge = document.getElementById('bottom-notif-count');

  // Not signed in → clear badges
  if (!user) {
    if (desktopBadge) { desktopBadge.textContent = ''; desktopBadge.classList.remove('show'); desktopBadge.style.display = 'none'; }
    if (mobileBadge) { mobileBadge.textContent = ''; mobileBadge.classList.remove('show'); mobileBadge.style.display = 'none'; }
    return;
  }

  try {
    const q = query(collection(db, 'notifications'), orderBy('sentAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    let unread = 0;

    snap.forEach(d => {
      const data = d.data();

      const recipientIds = Array.isArray(data.recipientIds) ? data.recipientIds : [];
      let recipients = data.recipients || [];
      if (typeof recipients === 'string') recipients = [recipients];
      if (!Array.isArray(recipients)) recipients = [];

      const isForAll = recipientIds.length === 0 && recipients.length === 0;
      const isForUser = isForAll
        || recipientIds.includes(user.uid)
        || recipients.includes(user.uid);
      if (!isForUser) return;

      if (Array.isArray(data.deletedFor) && data.deletedFor.includes(user.uid)) return;

      const read = Array.isArray(data.readBy) && data.readBy.includes(user.uid);
      if (!read) unread++;
    });

    const text = unread > 9 ? '9+' : (unread > 0 ? String(unread) : '');

    if (desktopBadge) {
      if (unread > 0) {
        desktopBadge.textContent = text;
        desktopBadge.classList.add('show');
        desktopBadge.style.display = 'flex';
      } else {
        desktopBadge.classList.remove('show');
        desktopBadge.style.display = 'none';
      }
    }

    if (mobileBadge) {
      if (unread > 0) {
        mobileBadge.textContent = text;
        mobileBadge.classList.add('show');
        mobileBadge.style.display = 'flex';
      } else {
        mobileBadge.classList.remove('show');
        mobileBadge.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('refreshHeaderNotifBadge error:', err);
  }
}

export function markNotificationAsRead(notificationId) {
  try {
    const notifications = JSON.parse(localStorage.getItem(NOTIFICATION_KEY)) || [];
    const updated = notifications.map(n =>
      n.id === notificationId ? { ...n, read: true } : n
    );
    localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(updated));
    updateNotificationBadge();
  } catch (e) {
    console.warn('Error marking notification as read:', e);
  }
}

export function markAllNotificationsAsRead() {
  try {
    const notifications = JSON.parse(localStorage.getItem(NOTIFICATION_KEY)) || [];
    const updated = notifications.map(n => ({ ...n, read: true }));
    localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(updated));
    updateNotificationBadge();
  } catch (e) {
    console.warn('Error marking all notifications as read:', e);
  }
}

export function addNotification(notification) {
  try {
    const notifications = JSON.parse(localStorage.getItem(NOTIFICATION_KEY)) || [];
    const newNotification = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      read: false,
      ...notification
    };
    notifications.unshift(newNotification);
    if (notifications.length > 100) {
      notifications.length = 100;
    }
    localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(notifications));
    updateNotificationBadge();
    return newNotification;
  } catch (e) {
    console.warn('Error adding notification:', e);
    return null;
  }
}

// ============================================================
//  NOTIFICATION MODAL FUNCTION
// ============================================================
export function openNotificationModal() {
  if (typeof window._notificationModalLoaded === 'function') {
    window._notificationModalLoaded();
    // [ADDED] Refresh header badge after modal closes or re-opens
    setTimeout(() => refreshHeaderNotifBadge(), 800);
    return;
  }

  import('./notifications.js')
    .then(module => {
      if (module.openNotificationModal) {
        window._notificationModalLoaded = module.openNotificationModal;
        module.openNotificationModal();
        setTimeout(() => refreshHeaderNotifBadge(), 800);
      } else {
        console.error('Notification module loaded but openNotificationModal not found');
        showToast('Notifications not available. Please refresh.');
      }
    })
    .catch(err => {
      console.error('Error loading notification modal:', err);
      showToast('Error loading notifications. Please refresh.');
    });
}

// ============================================================
//  TOAST NOTIFICATION
// ============================================================
let toastTimer = null;

export function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ============================================================
//  ACCOUNT MODAL / BOTTOM SHEET
// ============================================================
let accountModalInstance = null;
let accountModalOpen = false;

export function closeAccountModal() {
  if (accountModalInstance) {
    accountModalInstance.classList.remove('active');
    setTimeout(() => {
      if (accountModalInstance && accountModalInstance.parentNode) {
        accountModalInstance.parentNode.removeChild(accountModalInstance);
        accountModalInstance = null;
        accountModalOpen = false;
      }
    }, 300);
    document.removeEventListener('keydown', handleAccountEscape);
  } else {
    accountModalOpen = false;
  }
}

function handleAccountEscape(e) {
  if (e.key === 'Escape') {
    closeAccountModal();
  }
}

export function openAccountModal() {
  const user = auth.currentUser;
  if (!user) {
    openAuthModal();
    return;
  }

  if (accountModalOpen || accountModalInstance) {
    closeAccountModal();
    setTimeout(() => {
      openAccountModal();
    }, 300);
    return;
  }

  accountModalOpen = true;

  const userRef = doc(db, 'users', user.uid);
  getDoc(userRef).then((docSnap) => {
    if (!docSnap.exists()) {
      showToast('User data not found.');
      accountModalOpen = false;
      return;
    }

    const userData = docSnap.data();
    const userName = userData.name || 'Customer';
    const userPhoneRaw = userData.phone || user.phone || '';
    const userPhone = formatPhoneForDisplay(userPhoneRaw);
    const userEmail = userData.email || '';
    const userPhoto = userData.profilePic || userData.profilePhoto || userData.photoURL || null;

    const isMobile = window.innerWidth <= 768;

    const existingModal = document.getElementById('accountModal');
    if (existingModal) {
      existingModal.remove();
      accountModalInstance = null;
    }

    const modal = document.createElement('div');
    modal.className = isMobile ? 'account-bottom-sheet' : 'account-modal';
    modal.id = 'accountModal';

    let profileImageHtml = '';
    if (userPhoto) {
      profileImageHtml = `<img src="${userPhoto}" alt="${userName}" class="account-avatar-img" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'fas fa-user-circle\\'></i>';" />`;
    } else {
      profileImageHtml = `<i class="fas fa-user-circle"></i>`;
    }

    modal.innerHTML = `
      <div class="modal-overlay" id="accountModalOverlay"></div>
      <div class="modal-content">
        ${!isMobile ? `<button class="modal-close" id="accountModalClose">&times;</button>` : ''}
        <div class="account-modal-header">
          <div class="account-avatar">
            ${profileImageHtml}
          </div>
        <div class="account-user-info">
            <h3>${escapeHtml(userName)}</h3>
            ${userPhone ? `<p><i class="fas fa-phone"></i> ${escapeHtml(userPhone)}</p>` : ''}
            ${userEmail ? `<p><i class="fas fa-envelope"></i> ${escapeHtml(userEmail)}</p>` : ''}
          </div>
        </div>
        <div class="account-modal-body">
          <button class="account-btn view-profile" id="accountViewProfile">
            <i class="fas fa-user"></i> View Account
          </button>
          <button class="account-btn view-orders" id="accountViewOrders">
            <i class="fas fa-truck"></i> My Orders
          </button>
          <button class="account-btn logout" id="accountLogout">
            <i class="fas fa-sign-out-alt"></i> Logout
          </button>
        </div>
        ${isMobile ? `<div class="account-sheet-handle"></div>` : ''}
      </div>
    `;

    document.body.appendChild(modal);
    accountModalInstance = modal;

    setTimeout(() => {
      modal.classList.add('active');
    }, 10);

    const overlay = document.getElementById('accountModalOverlay');
    if (overlay) {
      overlay.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeAccountModal();
      });
    }

    const closeBtn = document.getElementById('accountModalClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeAccountModal();
      });
    }

    document.removeEventListener('keydown', handleAccountEscape);
    document.addEventListener('keydown', handleAccountEscape);

    const viewProfileBtn = document.getElementById('accountViewProfile');
    if (viewProfileBtn) {
      viewProfileBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeAccountModal();
        setTimeout(() => {
          window.location.href = '/account.html';
        }, 300);
      });
    }

    const viewOrdersBtn = document.getElementById('accountViewOrders');
    if (viewOrdersBtn) {
      viewOrdersBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeAccountModal();
        setTimeout(() => {
          window.location.href = '/my-orders.html';
        }, 300);
      });
    }

    const logoutBtn = document.getElementById('accountLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Are you sure you want to logout?')) return;
        auth.signOut().then(() => {
          closeAccountModal();
          showToast('Logged out successfully');
          setTimeout(() => {
            window.location.reload();
          }, 500);
        }).catch((error) => {
          console.error('Logout error:', error);
          showToast('Error logging out');
        });
      });
    }

    if (isMobile) {
      let startY = 0;
      let startX = 0;
      const content = modal.querySelector('.modal-content');

      content.addEventListener('touchstart', function(e) {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
      }, { passive: true });

      content.addEventListener('touchmove', function(e) {
        const deltaY = e.touches[0].clientY - startY;
        if (deltaY > 60 && Math.abs(e.touches[0].clientX - startX) < 30) {
          closeAccountModal();
        }
      }, { passive: true });
    }

  }).catch((error) => {
    console.error('Error loading user data:', error);
    showToast('Error loading account info');
    accountModalOpen = false;
  });
}

// ============================================================
//  UPDATE AUTH ICON STATE
// ============================================================
export function updateAuthIconState() {
  const user = auth.currentUser;
  const authBtn = document.getElementById('authBtn');
  const bottomAccountBtn = document.querySelector('.bottom-nav .nav-item[data-page="account"]');

  if (user) {
    if (authBtn) {
      authBtn.innerHTML = '<i class="fas fa-user-check"></i>';
      authBtn.style.color = '#F97316';
      authBtn.title = 'My Account';
    }
    if (bottomAccountBtn) {
      bottomAccountBtn.classList.add('logged-in');
      const icon = bottomAccountBtn.querySelector('i');
      if (icon) {
        icon.style.color = '#F97316';
      }
    }
  } else {
    if (authBtn) {
      authBtn.innerHTML = '<i class="fas fa-user"></i>';
      authBtn.style.color = '';
      authBtn.title = 'Sign in';
    }
    if (bottomAccountBtn) {
      bottomAccountBtn.classList.remove('logged-in');
      const icon = bottomAccountBtn.querySelector('i');
      if (icon) {
        icon.style.color = '';
      }
    }
  }
}

// ============================================================
//  AUTH MODAL
// ============================================================
let confirmationResult = null;
let currentVerifier = null;
let currentPhoneNumber = '';
let authCallback = null;
const recaptchaContainerId = 'auth-recaptcha-container';

function setupRecaptcha() {
  if (currentVerifier) {
    currentVerifier.clear();
    currentVerifier = null;
  }
  let container = document.getElementById(recaptchaContainerId);
  if (!container) {
    container = document.createElement('div');
    container.id = recaptchaContainerId;
    container.style.display = 'none';
    document.body.appendChild(container);
  }
  currentVerifier = new RecaptchaVerifier(auth, container, {
    size: 'invisible',
    callback: () => {}
  });
  return currentVerifier;
}

export function openAuthModal(callback) {
  authCallback = callback || null;
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const phoneForm = document.getElementById('phoneForm');
  const otpSection = document.getElementById('otpSection');
  const authMessage = document.getElementById('authMessage');
  const phoneInput = document.getElementById('phoneNumber');
  const otpInput = document.getElementById('otpCode');

  if (phoneForm) phoneForm.style.display = 'block';
  if (otpSection) otpSection.style.display = 'none';
  if (authMessage) { authMessage.textContent = ''; authMessage.className = 'auth-status'; }
  if (phoneInput) phoneInput.value = '';
  if (otpInput) otpInput.value = '';

  const sendBtn = document.getElementById('sendOtpBtn');
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.innerHTML = 'Send OTP';
  }
  const verifyBtn = document.getElementById('verifyBtn');
  if (verifyBtn) {
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = 'Verify & Sign In';
  }

  document.body.style.overflow = 'hidden';
  if (phoneInput) phoneInput.focus();
}

export function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  if (currentVerifier) {
    currentVerifier.clear();
    currentVerifier = null;
  }
  confirmationResult = null;
  authCallback = null;
}

export function initAuthModal() {
  const modal = document.getElementById('authModal');
  const closeSpan = modal ? modal.querySelector('.close') : null;
  const phoneForm = document.getElementById('phoneForm');
  const phoneInput = document.getElementById('phoneNumber');
  const otpSection = document.getElementById('otpSection');
  const otpInput = document.getElementById('otpCode');
  const verifyBtn = document.getElementById('verifyBtn');
  const authMessage = document.getElementById('authMessage');
  const otpPhoneDisplay = document.getElementById('otpPhoneDisplay');
  const resendOtpBtn = document.getElementById('resendOtpBtn');
  const sendOtpBtn = document.getElementById('sendOtpBtn');

  if (!modal || !phoneForm) return;

  if (phoneInput) phoneInput.value = '';

  if (closeSpan) {
    closeSpan.onclick = closeAuthModal;
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAuthModal();
  });

  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', async () => {
      if (!currentPhoneNumber) {
        if (authMessage) {
          authMessage.textContent = 'Please enter your phone number first.';
          authMessage.className = 'auth-status error';
        }
        return;
      }
      if (authMessage) {
        authMessage.textContent = 'Resending OTP...';
        authMessage.className = 'auth-status verifying';
      }
      resendOtpBtn.disabled = true;
      try {
        const appVerifier = setupRecaptcha();
        const result = await signInWithPhoneNumber(auth, currentPhoneNumber, appVerifier);
        confirmationResult = result;
        if (authMessage) {
          authMessage.textContent = 'OTP resent! Check your phone.';
          authMessage.className = 'auth-status success';
        }
      } catch (error) {
        console.error(error);
        if (authMessage) {
          authMessage.textContent = 'Error: ' + error.message;
          authMessage.className = 'auth-status error';
        }
        currentVerifier = null;
      }
      resendOtpBtn.disabled = false;
    });
  }

  if (phoneForm) {
    phoneForm.onsubmit = async (e) => {
      e.preventDefault();
      const raw = (phoneInput ? phoneInput.value : '').replace(/\D/g, '');

      if (!raw || raw.length !== 9) {
        if (authMessage) {
          authMessage.textContent = 'Please enter a 9-digit mobile number.';
          authMessage.className = 'auth-status error';
        }
        if (phoneInput) phoneInput.focus();
        return;
      }

      const formattedPhone = '+27' + raw;
      currentPhoneNumber = formattedPhone;

      if (authMessage) {
        authMessage.textContent = 'Sending OTP...';
        authMessage.className = 'auth-status verifying';
      }
      if (sendOtpBtn) {
        sendOtpBtn.disabled = true;
        sendOtpBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      }

      try {
        const appVerifier = setupRecaptcha();
        const result = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
        confirmationResult = result;

        if (authMessage) {
          authMessage.textContent = 'OTP sent! Enter the code below.';
          authMessage.className = 'auth-status success';
        }
        if (phoneForm) phoneForm.style.display = 'none';
        if (otpSection) otpSection.style.display = 'block';
        if (otpPhoneDisplay) otpPhoneDisplay.textContent = formattedPhone;
        if (otpInput) otpInput.focus();
      } catch (error) {
        console.error(error);
        if (authMessage) {
          authMessage.textContent = 'Error: ' + error.message;
          authMessage.className = 'auth-status error';
        }
        currentVerifier = null;
      }
      if (sendOtpBtn) {
        sendOtpBtn.disabled = false;
        sendOtpBtn.innerHTML = 'Send OTP';
      }
    };
  }

  if (verifyBtn) {
    verifyBtn.onclick = async () => {
      const code = otpInput ? otpInput.value.trim() : '';
      if (!code || code.length !== 6) {
        if (authMessage) {
          authMessage.textContent = 'Please enter a valid 6-digit code.';
          authMessage.className = 'auth-status error';
        }
        return;
      }

      if (authMessage) {
        authMessage.textContent = 'Verifying...';
        authMessage.className = 'auth-status verifying';
      }
      if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
      }

      try {
        const result = await confirmationResult.confirm(code);
        const phone = currentPhoneNumber;
        const uid = result.user.uid;

        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);

        let existingName = '';

        if (userSnap.exists()) {
          const existingData = userSnap.data();
          existingName = existingData.name || '';

          if (authMessage) {
            authMessage.textContent = `Welcome back${existingName ? ', ' + existingName : ''}!`;
            authMessage.className = 'auth-status success';
          }
        } else {
          const userData = {
            phone: phone,
            role: 'customer',
            createdAt: new Date(),
            updatedAt: new Date()
          };
          await setDoc(userRef, userData, { merge: true });

          if (authMessage) {
            authMessage.textContent = 'Account created successfully!';
            authMessage.className = 'auth-status success';
          }
        }

        setTimeout(() => subscribeToPush(), 3000);

        if (verifyBtn) {
          verifyBtn.innerHTML = '✅ Verified';
        }

        setTimeout(() => {
          closeAuthModal();
          if (authCallback) {
            const callback = authCallback;
            authCallback = null;
            callback();
          } else {
            location.reload();
          }
        }, 1500);

      } catch (error) {
        console.error(error);
        if (authMessage) {
          authMessage.textContent = 'Error: Invalid code. Please try again.';
          authMessage.className = 'auth-status error';
        }
        if (otpInput) otpInput.value = '';
        if (otpInput) otpInput.focus();
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.innerHTML = 'Verify & Sign In';
        }
      }
    };
  }
}

// ============================================================
//  LEGAL MODALS
// ============================================================
let legalEscHandler = null;

export function openLegalModal(type) {
  const container = document.getElementById('legalModalContainer');
  if (!container) return;

  const fileMap = {
    'privacy': 'privacy',
    'terms': 'terms',
    'cookie-info': 'cookies'
  };
  const fileName = fileMap[type] || type;

  fetch(`modals/${fileName}.html`)
    .then(res => {
      if (!res.ok) throw new Error('Modal not found');
      return res.text();
    })
    .then(html => {
      container.innerHTML = html;
      container.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      container.querySelector('.legal-modal-close')?.addEventListener('click', () => closeLegalModal());
      container.querySelector('.legal-modal-overlay')?.addEventListener('click', () => closeLegalModal());
      container.querySelector('.legal-accept-btn')?.addEventListener('click', () => closeLegalModal());

      container.addEventListener('click', (e) => {
        if (e.target === container) closeLegalModal();
      });

      if (legalEscHandler) document.removeEventListener('keydown', legalEscHandler);
      legalEscHandler = (e) => {
        if (e.key === 'Escape') closeLegalModal();
      };
      document.addEventListener('keydown', legalEscHandler);
    })
    .catch(err => {
      console.error('Error loading legal modal:', err);
      showToast('Could not load legal document. Please try again.');
    });
}

export function closeLegalModal() {
  const container = document.getElementById('legalModalContainer');
  if (container) {
    container.style.display = 'none';
    container.innerHTML = '';
    const authOpen = document.getElementById('authModal')?.style.display === 'flex';
    const accountOpen = document.getElementById('accountModal')?.classList.contains('active');
    if (!authOpen && !accountOpen) {
      document.body.style.overflow = '';
    }
    if (legalEscHandler) {
      document.removeEventListener('keydown', legalEscHandler);
      legalEscHandler = null;
    }
  }
}

export function initLegalModals() {
  document.querySelectorAll('.legal-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const modalType = link.dataset.modal;
      if (modalType) {
        openLegalModal(modalType);
      }
    });
  });
}

// ============================================================
//  CART MODAL
// ============================================================
let cartModalState = {
  storeName: null,
  storeId: null,
  products: []
};

export function openCartModal() {
  const modal = document.getElementById('cartModal');
  if (!modal) {
    window.location.href = 'cart.html';
    return;
  }

  renderCartModal();
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

export function closeCartModal() {
  const modal = document.getElementById('cartModal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => {
    modal.hidden = true;
    document.body.style.overflow = '';
  }, 250);
}

async function renderCartModal() {
  const modal = document.getElementById('cartModal');
  if (!modal) return;

  const body = modal.querySelector('.cart-modal-body');
  const footer = modal.querySelector('.cart-modal-footer');
  const badge = modal.querySelector('.cart-modal-count');
  const storeBadge = modal.querySelector('.cart-modal-store-badge');
  const storeNameEl = modal.querySelector('.cart-modal-store-name');

  const cart = getCartUtil();
  const totalQty = cart.reduce((s, i) => s + (i.quantity || 0), 0);

  if (badge) badge.textContent = totalQty;

  if (cart.length === 0) {
    if (storeBadge) storeBadge.hidden = true;
    if (body) {
      body.innerHTML = `
        <div class="cart-modal-empty">
          <div class="cart-modal-empty-icon"><i class="fas fa-shopping-bag"></i></div>
          <h3>Your cart is empty</h3>
          <p>Browse stores and add items you love. We'll keep them here for you.</p>
        </div>
      `;
    }
    if (footer) {
      footer.innerHTML = `
        <a class="cart-modal-btn primary" href="stores.html">
          <i class="fas fa-store"></i> Start Shopping
        </a>
      `;
    }
    return;
  }

  const storeName = cart[0].store || '';
  const storeId = cart[0].storeId || null;
  cartModalState.storeName = storeName;
  cartModalState.storeId = storeId;

  if (storeBadge && storeName) {
    storeBadge.hidden = false;
    if (storeNameEl) storeNameEl.textContent = storeName;
  } else if (storeBadge) {
    storeBadge.hidden = true;
  }

  let liveProducts = [];
  if (storeId) {
    try {
      const q = query(collection(db, 'products'), where('storeId', '==', storeId));
      const snap = await getDocs(q);
      snap.forEach(d => liveProducts.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[cart modal] could not load products:', err);
    }
  }

  const findLive = (item) => {
    if (item.productId) {
      const byPid = liveProducts.find(p => p.id === item.productId);
      if (byPid) return byPid;
    }
    return liveProducts.find(p => p.id === item.id) || null;
  };

  const activePrice = (item) => {
    const live = findLive(item);
    if (live) return getActivePrice(live);
    return Number(item.price) || 0;
  };

  const basePriceOf = (item) => {
    const live = findLive(item);
    if (live) return Number(live.price) || 0;
    return Number(item.basePrice ?? item.price) || 0;
  };

  const subtotal = cart.reduce((s, i) => s + (activePrice(i) * i.quantity), 0);

  const itemsHtml = cart.map((item, idx) => {
    const unit = activePrice(item);
    const base = basePriceOf(item);
    const isSpecial = base > 0 && unit < base;
    const lineTotal = unit * item.quantity;

    const priceRow = isSpecial
      ? `<div class="cart-modal-item-price">
           <span class="cart-modal-item-price-now">R${lineTotal.toFixed(2)}</span>
           <s class="cart-modal-item-price-old">R${(base * item.quantity).toFixed(2)}</s>
         </div>`
      : `<div class="cart-modal-item-price">R${lineTotal.toFixed(2)}</div>`;

    const specialTag = isSpecial
      ? `<div class="cart-modal-item-special"><i class="fas fa-bolt"></i> Special price applied</div>`
      : '';

    return `
      <div class="cart-modal-item" data-index="${idx}">
        <img class="cart-modal-item-img" src="${escapeHtmlAttr(item.image || 'img/placeholder.jpg')}" alt="${escapeHtmlAttr(item.name)}" onerror="this.src='img/placeholder.jpg'" />
        <div class="cart-modal-item-info">
          <div class="cart-modal-item-name">${escapeHtmlAttr(item.name)}</div>
          ${priceRow}
          ${specialTag}
        </div>
        <div class="cart-modal-item-qty">
          <button type="button" class="cart-modal-qty-btn" data-action="dec" data-index="${idx}" aria-label="Decrease">
            <i class="fas fa-minus"></i>
          </button>
          <span class="cart-modal-qty-value">${item.quantity}</span>
          <button type="button" class="cart-modal-qty-btn" data-action="inc" data-index="${idx}" aria-label="Increase">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <button type="button" class="cart-modal-remove" data-action="remove" data-index="${idx}" aria-label="Remove">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `;
  }).join('');

  if (body) {
    body.innerHTML = `
      <div class="cart-modal-search">
        <i class="fas fa-search"></i>
        <input type="text" id="cartModalSearchInput" placeholder="Search items to add from ${escapeHtmlAttr(storeName)}..." autocomplete="off" />
      </div>
      <div class="cart-modal-search-results" id="cartModalSearchResults"></div>
      <div class="cart-modal-items">${itemsHtml}</div>
    `;

    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const idx = parseInt(btn.dataset.index, 10);
        const cart = getCartUtil();
        if (action === 'inc') {
          cart[idx].quantity = (cart[idx].quantity || 1) + 1;
        } else if (action === 'dec') {
          if ((cart[idx].quantity || 1) > 1) {
            cart[idx].quantity = cart[idx].quantity - 1;
          } else {
            cart.splice(idx, 1);
          }
        } else if (action === 'remove') {
          cart.splice(idx, 1);
        }
        saveCartUtil(cart);
        updateBadge();
        renderCartModal();
      });
    });

    const searchInput = body.querySelector('#cartModalSearchInput');
    const searchResults = body.querySelector('#cartModalSearchResults');
    if (searchInput && searchResults && storeId) {
      let debounceTimer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const q = searchInput.value.trim().toLowerCase();
          if (q.length < 2) {
            searchResults.classList.remove('active');
            searchResults.innerHTML = '';
            return;
          }
          await performCartSearch(q, storeId, storeName, searchResults);
        }, 220);
      });
    }
  }

  if (footer) {
    footer.innerHTML = `
      <div class="cart-modal-total">
        <span>Subtotal</span>
        <strong>R${subtotal.toFixed(2)}</strong>
      </div>
      <div class="cart-modal-actions">
        <a class="cart-modal-btn secondary" href="/cart.html">
          <i class="fas fa-shopping-bag"></i> Go to Cart
        </a>
        <a class="cart-modal-btn primary" href="/checkout.html">
          <i class="fas fa-lock"></i> Checkout
        </a>
      </div>
    `;
  }
}

async function performCartSearch(searchTerm, storeId, storeName, resultsEl) {
  try {
    const q = query(collection(db, 'products'), where('storeId', '==', storeId));
    const snap = await getDocs(q);
    const allProds = [];
    snap.forEach(d => allProds.push({ id: d.id, ...d.data() }));

    const term = (searchTerm || '').toLowerCase();

    const matches = allProds.filter(p =>
      (p.stock !== false) &&
      (
        (p.name || '').toLowerCase().includes(term) ||
        (p.desc || '').toLowerCase().includes(term) ||
        (p.category || '').toLowerCase().includes(term)
      )
    ).slice(0, 20);

    if (!matches.length) {
      resultsEl.innerHTML = `<div class="cart-modal-no-results">No items found in ${escapeHtmlAttr(storeName)}</div>`;
      resultsEl.classList.add('active');
      return;
    }

    resultsEl.innerHTML = matches.map(p => {
      const active = getActivePrice(p);
      const base = Number(p.price) || 0;
      const isSpecial = active !== base;
      const priceHtml = isSpecial
        ? `<div class="cart-modal-search-result-price">R${active.toFixed(2)} <s style="color:var(--text-muted);font-size:0.72rem;">R${base.toFixed(2)}</s></div>`
        : `<div class="cart-modal-search-result-price">R${base.toFixed(2)}</div>`;

      return `
        <div class="cart-modal-search-result" data-id="${p.id}">
          <img src="${escapeHtmlAttr(p.image || 'img/placeholder.jpg')}" alt="${escapeHtmlAttr(p.name)}" onerror="this.src='img/placeholder.jpg'" />
          <div class="cart-modal-search-result-info">
            <div class="cart-modal-search-result-name">${escapeHtmlAttr(p.name || '')}</div>
            ${priceHtml}
          </div>
          <button type="button" class="cart-modal-search-result-add" data-action="add" data-id="${p.id}" aria-label="Add">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      `;
    }).join('');
    resultsEl.classList.add('active');

    resultsEl.querySelectorAll('[data-action="add"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const prod = matches.find(m => m.id === id);
        if (!prod) return;

        const cart = getCartUtil();
        const existing = cart.find(i => i.id === prod.id || i.productId === prod.id);
        const active = getActivePrice(prod);

        if (existing) {
          existing.quantity = (existing.quantity || 1) + 1;
          existing.price = active;
          existing.basePrice = Number(prod.price) || 0;
          existing.productId = prod.id;
        } else {
          cart.push({
            id: prod.id,
            productId: prod.id,
            name: prod.name,
            store: storeName,
            storeId: storeId,
            price: active,
            basePrice: Number(prod.price) || 0,
            quantity: 1,
            image: prod.image || 'img/placeholder.jpg',
            category: prod.category || 'Uncategorized'
          });
        }
        saveCartUtil(cart);
        updateBadge();
        showToast(`${prod.name} added to cart!`);
        renderCartModal();
      });
    });

  } catch (err) {
    console.warn('Cart search failed:', err);
    resultsEl.innerHTML = `<div class="cart-modal-no-results">Search unavailable right now</div>`;
    resultsEl.classList.add('active');
  }
}

function escapeHtmlAttr(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
//  PWA INSTALL
// ============================================================
let deferredPrompt = null;
let installBanner = null;

export function initPWA() {
  installBanner = document.getElementById('install-banner');
  if (!installBanner) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) {
    installBanner.classList.add('hidden');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('installDismissed') && !isStandalone) {
      installBanner.classList.remove('hidden');
    }
  });

  document.getElementById('banner-install-btn')?.addEventListener('click', triggerInstall);
  document.getElementById('banner-dismiss')?.addEventListener('click', () => {
    installBanner.classList.add('hidden');
    localStorage.setItem('installDismissed', 'true');
  });

  window.addEventListener('appinstalled', () => {
    if (installBanner) installBanner.classList.add('hidden');
  });
}

async function triggerInstall() {
  if (!deferredPrompt) {
    showToast('Open this page in Chrome or Edge to install the app.');
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    if (installBanner) installBanner.classList.add('hidden');
    deferredPrompt = null;
    showToast('Ghost Shopper installed! 🎉');
  }
}

// ============================================================
//  BOTTOM NAVIGATION
// ============================================================
export function initBottomNav() {
  const bottomNavItems = document.querySelectorAll('.nav-item');

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  let currentPage = null;

  if (currentPath.includes('index') || currentPath === '' || currentPath === '/') {
    currentPage = 'home';
  } else if (currentPath.includes('about')) {
    currentPage = 'about';
  } else if (currentPath.includes('stores')) {
    currentPage = 'stores';
  } else if (currentPath.includes('store')) {
    currentPage = 'stores';
  } else if (currentPath.includes('cart')) {
    currentPage = 'cart';
  } else if (currentPath.includes('orders') || currentPath.includes('my-orders')) {
    currentPage = 'orders';
  } else if (currentPath.includes('account')) {
    currentPage = 'account';
  } else if (currentPath.includes('notifications')) {
    currentPage = 'notifications';
  } else if (currentPath.includes('checkout')) {
    currentPage = 'cart';
  } else if (currentPath.includes('confirmation')) {
    currentPage = 'orders';
  }

  bottomNavItems.forEach(item => {
    const page = item.dataset.page;
    if (page === currentPage) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  bottomNavItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const page = item.dataset.page;

      if (page === 'notifications') {
        e.preventDefault();
        openNotificationModal();
        return;
      }

      if (page === 'account') {
        e.preventDefault();
        const user = auth.currentUser;
        if (user) {
          openAccountModal();
        } else {
          openAuthModal();
        }
        return;
      }

      if (page === 'cart') {
        const cart = getCartUtil();
        if (document.getElementById('cartModal')) {
          e.preventDefault();
          openCartModal();
          return;
        }
        if (cart.length === 0) {
          const emptyMessages = [
            "🛒 Nothing here! Shop and unlock me! 🛍️",
            "🛒 Your cart is empty. Start shopping! 🛍️",
            "🛒 Add some items to unlock me! 🛍️"
          ];
          const randomMsg = emptyMessages[Math.floor(Math.random() * emptyMessages.length)];
          showToast(randomMsg);
          return;
        }
      }

      const isSamePage = page === currentPage;

      if (isSamePage) {
        if (page === 'home') {
          showToast('You\'re already home — why not shop? 😉');
        } else if (page === 'stores') {
          showToast('Browse all stores here! 🏪');
        } else if (page === 'cart') {
          if (document.getElementById('cartModal')) {
            openCartModal();
            return;
          }
          showToast('Do we have everything? Let\'s check and make sure!');
          const icon = item.querySelector('i');
          if (icon) {
            icon.classList.add('cart-blink');
            setTimeout(() => icon.classList.remove('cart-blink'), 2000);
          }
        } else if (page === 'account') {
          const user = auth.currentUser;
          if (user) {
            openAccountModal();
          } else {
            openAuthModal();
          }
        }
        return;
      }

      if (page === 'home') window.location.href = '/index.html';
      else if (page === 'stores') window.location.href = '/stores.html';
      else if (page === 'cart') window.location.href = '/cart.html';
    });
  });
}

// ============================================================
//  DESKTOP NAVIGATION
// ============================================================
export function initDesktopNav() {
  const desktopCartBtn = document.getElementById('desktopCartBtn');
  if (desktopCartBtn) {
    desktopCartBtn.addEventListener('click', (e) => {
      const cart = getCartUtil();
      if (document.getElementById('cartModal')) {
        e.preventDefault();
        openCartModal();
        return;
      }
      if (cart.length === 0) {
        e.preventDefault();
        const emptyMessages = [
          "🛒 Nothing here! Shop and unlock me! 🛍️",
          "🛒 Your cart is empty. Start shopping! 🛍️",
          "🛒 Add some items to unlock me! 🛍️"
        ];
        const randomMsg = emptyMessages[Math.floor(Math.random() * emptyMessages.length)];
        showToast(randomMsg);
      }
    });
  }

  const desktopNotifyBtn = document.getElementById('desktopNotifyBtn');
  if (desktopNotifyBtn) {
    desktopNotifyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openNotificationModal();
    });
  }

  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    authBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      if (user) {
        openAccountModal();
      } else {
        openAuthModal();
      }
    });
  }
}

// ============================================================
//  COOKIE CONSENT
// ============================================================
export function initCookieConsent() {
  const cookieBanner = document.getElementById('cookieBanner');
  const cookieAccept = document.getElementById('cookieAccept');
  const cookieDecline = document.getElementById('cookieDecline');
  const cookieInfoBtn = document.getElementById('cookieInfoBtn');

  if (!cookieBanner) return;

  if (!localStorage.getItem('cookieConsent')) {
    cookieBanner.classList.add('active');
  }

  cookieAccept?.addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'accepted');
    cookieBanner.classList.remove('active');
    showToast('🍪 Thank you! Cookies enabled.');
  });

  cookieDecline?.addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'declined');
    cookieBanner.classList.remove('active');
    showToast('🍪 Only essential cookies will be used.');
  });

  cookieInfoBtn?.addEventListener('click', () => {
    openLegalModal('cookie-info');
  });
}

// ============================================================
//  SERVICE WORKER REGISTRATION
// ============================================================
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('⚠️ Service workers not supported');
    return null;
  }

  try {
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isDev) {
      const mainReg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/public/'
      });
      console.log('✅ Main SW registered (dev):', mainReg);

      const fcmReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/public/'
      });
      console.log('✅ FCM SW registered (dev):', fcmReg);
    } else {
      const mainReg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('✅ Main SW registered (prod):', mainReg);

      const fcmReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/'
      });
      console.log('✅ FCM SW registered (prod):', fcmReg);
    }

    await navigator.serviceWorker.ready;
    console.log('✅ All service workers ready');
    return true;
  } catch (error) {
    console.warn('⚠️ Service worker registration skipped:', error.message);
    return null;
  }
}

// ============================================================
//  FCM PUSH SUBSCRIPTION
// ============================================================
export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('🔕 Push not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration) {
      console.warn('🔕 No service worker registration');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('🔕 Notification permission denied');
      return;
    }

    const messaging = getMessaging();

    const token = await getToken(messaging, {
      vapidKey: 'BFiovOEAOgZUXWJgo6h5bCw-MgoJmdZTyCjfGpy5EhArqnOlkQjkMjukgh_I74Z0A48XWNQWKy4_xeOAaCj6XMI'
    });

    if (!token) {
      console.warn('🔕 No FCM token received');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      console.warn('🔕 No user signed in');
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      console.warn('🔕 User document not found');
      return;
    }

    const currentTokens = userDoc.data().fcmTokens || [];
    if (!currentTokens.includes(token)) {
      const updated = [...currentTokens, token];
      await updateDoc(userRef, { fcmTokens: updated });
      console.log('✅ FCM token saved:', token);
    } else {
      console.log('ℹ️ FCM token already exists');
    }

    onMessage(messaging, (payload) => {
      console.log('📨 Foreground message:', payload);
      const title = payload.notification?.title || 'Ghost Shopper';
      const body = payload.notification?.body || 'You have a new notification';
      showToast(`🔔 ${title}: ${body}`);
      // [ADDED] Refresh header badge when a push arrives in foreground
      setTimeout(() => refreshHeaderNotifBadge(), 800);
    });

  } catch (error) {
    console.error('❌ FCM subscribe error:', error);
    if (error.name === 'AbortError') {
      console.warn('🔕 Subscription aborted – retrying...');
      setTimeout(() => subscribeToPush(), 2000);
    }
  }
}

export async function unsubscribeFromPush() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const messaging = getMessaging();
    const token = await getToken(messaging);
    if (token) {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const tokens = userDoc.data().fcmTokens || [];
        const updated = tokens.filter(t => t !== token);
        await updateDoc(userRef, { fcmTokens: updated });
        console.log('🔕 FCM token removed');
      }
    }
  } catch (error) {
    console.error('❌ FCM unsubscribe error:', error);
  }
}

export async function toggleNotifications(enabled) {
  const user = auth.currentUser;
  if (!user) {
    showToast('Please sign in to manage notifications.');
    return;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      notificationsEnabled: enabled,
      updatedAt: new Date()
    });

    if (enabled) {
      await subscribeToPush();
      showToast('🔔 Notifications enabled!');
    } else {
      await unsubscribeFromPush();
      showToast('🔕 Notifications disabled.');
    }
  } catch (error) {
    console.error('Error toggling notifications:', error);
    showToast('❌ Error updating notification settings.');
  }
}

// ============================================================
//  PHONE FORMATTING HELPERS
// ============================================================
function formatPhoneForDisplay(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (digits.length !== 9) return '+27 ' + digits;
  return `+27 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

function phoneToLocalDigits(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

window.gsFormatPhone = formatPhoneForDisplay;
window.gsPhoneToLocal = phoneToLocalDigits;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
//  INIT FUNCTION
// ============================================================
export async function initGlobal() {
  initPWA();
  initAuthModal();
  initLegalModals();
  initCookieConsent();
  initCartModalListeners();

  await registerServiceWorker();

  updateBadge();
  updateNotificationBadge();
  updateAuthIconState();

  // [ADDED] Initial refresh of header bell from Firestore
  refreshHeaderNotifBadge();

  if (auth.currentUser) {
    setTimeout(() => subscribeToPush(), 3000);
  }

  setTimeout(() => {
    initAddressSearch();
  }, 500);

  setTimeout(() => {
    initBottomNav();
    initDesktopNav();
  }, 100);

  window.addEventListener('storage', (e) => {
    if (e.key === 'ghostShopperCart') {
      updateBadge();
    }
    if (e.key === 'ghostShopperNotifications') {
      updateNotificationBadge();
    }
  });

  // [ADDED] Refresh header badge on every auth state change
  auth.onAuthStateChanged(() => {
    updateAuthIconState();
    refreshHeaderNotifBadge();
  });
}

// ============================================================
//  CART MODAL LISTENERS
// ============================================================
function initCartModalListeners() {
  const modal = document.getElementById('cartModal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.cart-modal-close');
  const backdrop = modal.querySelector('.cart-modal-backdrop');

  if (closeBtn) closeBtn.addEventListener('click', closeCartModal);
  if (backdrop) backdrop.addEventListener('click', closeCartModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeCartModal();
    }
  });
}

// ============================================================
//  EXPOSE TO WINDOW
// ============================================================
window.showToast = showToast;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.openLegalModal = openLegalModal;
window.closeLegalModal = closeLegalModal;
window.updateCartBadge = updateBadge;
window.getCart = getCartUtil;
window.saveCart = saveCartUtil;
window.clearCart = clearCartUtil;
window.getSavedAddress = getSavedAddress;
window.saveAddress = saveAddress;
window.updateAddressInputs = updateAddressInputs;
window.initAddressSearch = initAddressSearch;
window.updateNotificationBadge = updateNotificationBadge;
window.getUnreadNotificationCount = getUnreadNotificationCount;
window.addNotification = addNotification;
window.markAllNotificationsAsRead = markAllNotificationsAsRead;
window.markNotificationAsRead = markNotificationAsRead;
window.subscribeToPush = subscribeToPush;
window.unsubscribeFromPush = unsubscribeFromPush;
window.toggleNotifications = toggleNotifications;
window.openNotificationModal = openNotificationModal;
window.openAccountModal = openAccountModal;
window.closeAccountModal = closeAccountModal;
window.updateAuthIconState = updateAuthIconState;
window.openCartModal = openCartModal;
window.closeCartModal = closeCartModal;
window.refreshHeaderNotifBadge = refreshHeaderNotifBadge;