// ============================================================
//  GLOBAL.JS - Shared functions for all pages
//  Import this in every page BEFORE page-specific JS
// ============================================================

import { 
  auth, 
  db, 
  signInWithPhoneNumber, 
  RecaptchaVerifier 
} from '../../js/firebase-config.js';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  query,
  where,
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
  getCartItemCount as getCartItemCountUtil 
} from '../../js/cart-utils.js';

// ============================================================
//  CART EXPORTS (re-export from cart-utils)
// ============================================================
export const updateCartBadge = updateBadge;
export const getCart = getCartUtil;
export const saveCart = saveCartUtil;
export const clearCart = clearCartUtil;
export const getCartTotal = getCartTotalUtil;
export const getCartItemCount = getCartItemCountUtil;

// ============================================================
//  ADDRESS FUNCTIONS (Shared across all pages)
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
//  ADDRESS SEARCH INIT (unchanged)
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
    console.warn('⚠️ Address input not found on this page');
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
//  NOTIFICATION FUNCTIONS (unchanged)
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
      mobileBadge.textContent = '•';
      mobileBadge.classList.add('show');
    } else {
      mobileBadge.classList.remove('show');
    }
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
//  AUTH MODAL (unchanged)
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

function formatPhoneNumber(number) {
  let cleaned = number.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '27' + cleaned.substring(1);
  if (cleaned.startsWith('27') && !cleaned.startsWith('+')) cleaned = '+' + cleaned;
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

export function openAuthModal(callback) {
  authCallback = callback || null;
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const phoneForm = document.getElementById('phoneForm') || document.getElementById('authPhoneForm');
  const otpSection = document.getElementById('otpSection') || document.getElementById('authOtpSection');
  const authMessage = document.getElementById('authMessage') || document.getElementById('authStatus');
  const phoneInput = document.getElementById('phoneNumber') || document.getElementById('authPhoneInput');
  const nameInput = document.getElementById('nameInput');
  const otpInput = document.getElementById('otpCode') || document.getElementById('authOtpInput');
  
  if (phoneForm) phoneForm.style.display = 'block';
  if (otpSection) otpSection.style.display = 'none';
  if (authMessage) {
    authMessage.textContent = '';
    authMessage.className = 'auth-status';
  }
  if (phoneInput) phoneInput.value = '+27';
  if (otpInput) otpInput.value = '';
  if (nameInput) nameInput.value = '';
  
  const sendBtn = document.getElementById('authSendOtpBtn') || document.getElementById('sendOtpBtn');
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send OTP';
  }
  const verifyBtn = document.getElementById('authVerifyBtn') || document.getElementById('verifyBtn');
  if (verifyBtn) {
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Verify & Sign In';
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
  const closeSpan = document.querySelector('.close') || document.getElementById('authModalClose');
  const overlay = document.getElementById('authModalOverlay');
  const phoneForm = document.getElementById('phoneForm') || document.getElementById('authPhoneForm');
  const phoneInput = document.getElementById('phoneNumber') || document.getElementById('authPhoneInput');
  const nameInput = document.getElementById('nameInput');
  const otpSection = document.getElementById('otpSection') || document.getElementById('authOtpSection');
  const otpInput = document.getElementById('otpCode') || document.getElementById('authOtpInput');
  const verifyBtn = document.getElementById('verifyBtn') || document.getElementById('authVerifyBtn');
  const authMessage = document.getElementById('authMessage') || document.getElementById('authStatus');
  const otpPhoneDisplay = document.getElementById('otpPhoneDisplay');
  const resendOtpBtn = document.getElementById('resendOtpBtn') || document.getElementById('authResendBtn');
  const sendOtpBtn = document.getElementById('authSendOtpBtn') || document.getElementById('sendOtpBtn');

  if (!modal || !phoneForm) return;

  if (phoneInput) phoneInput.value = '+27';

  if (closeSpan) {
    closeSpan.onclick = closeAuthModal;
  }
  if (overlay) {
    overlay.onclick = closeAuthModal;
  }

  window.onclick = (e) => { 
    if (e.target === modal) closeAuthModal(); 
  };

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
      const phone = phoneInput ? phoneInput.value.trim() : '';
      if (!phone || phone === '+27') {
        if (authMessage) {
          authMessage.textContent = 'Please enter a valid phone number.';
          authMessage.className = 'auth-status error';
        }
        return;
      }
      
      const formattedPhone = formatPhoneNumber(phone);
      currentPhoneNumber = formattedPhone;
      if (phoneInput) phoneInput.value = formattedPhone;
      
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
        sendOtpBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send OTP';
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
        const name = nameInput ? nameInput.value.trim() || '' : '';
        const phone = currentPhoneNumber || (phoneInput ? phoneInput.value.trim() || '' : '');
        
        const phoneQuery = query(collection(db, 'users'), where('phone', '==', phone));
        const querySnap = await getDocs(phoneQuery);
        
        let existingName = '';
        
        if (!querySnap.empty) {
          const existingDoc = querySnap.docs[0];
          const existingData = existingDoc.data();
          existingName = existingData.name || '';
          
          if (name && !existingName) {
            await setDoc(doc(db, 'users', result.user.uid), { 
              name: name,
              updatedAt: new Date()
            }, { merge: true });
            existingName = name;
          }
          
          if (authMessage) {
            authMessage.textContent = `Welcome back${existingName ? ', ' + existingName : ''}!`;
            authMessage.className = 'auth-status success';
          }
        } else {
          const userData = { 
            name: name,
            phone: phone,
            role: 'customer',
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          await setDoc(doc(db, 'users', result.user.uid), userData);
          
          if (authMessage) {
            authMessage.textContent = name ? `Welcome, ${name}!` : 'Account created successfully!';
            authMessage.className = 'auth-status success';
          }
        }
        
        // --- AUTO-SUBSCRIBE TO PUSH AFTER SIGN-IN ---
        // Wait a bit for service worker to be ready
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
          verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Verify & Sign In';
        }
      }
    };
  }
}

// ============================================================
//  LEGAL MODALS (unchanged)
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
      
      if (legalEscHandler) {
        document.removeEventListener('keydown', legalEscHandler);
      }
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
    document.body.style.overflow = '';
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
//  PWA INSTALL (unchanged)
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
//  BOTTOM NAVIGATION (unchanged)
// ============================================================
export function initBottomNav() {
  const bottomNavItems = document.querySelectorAll('.nav-item');
  
  const currentPath = window.location.pathname.split('/').pop() || '/index';
  let currentPage = 'home';
  
  if (currentPath.includes('index') || currentPath === '' || currentPath === '/') {
    currentPage = 'home';
  } else if (currentPath.includes('store')) {
    currentPage = 'store';
  } else if (currentPath.includes('cart')) {
    currentPage = 'cart';
  } else if (currentPath.includes('orders') || currentPath.includes('my-orders')) {
    currentPage = 'orders';
  } else if (currentPath.includes('account')) {
    currentPage = 'account';
  } else if (currentPath.includes('notifications')) {
    currentPage = 'notifications';
  } else if (currentPath.includes('checkout')) {
    currentPage = 'checkout';
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
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      
      if (page === 'notifications') {
        const count = getUnreadNotificationCount();
        if (count > 0) {
          window.location.href = '/notifications';
        } else {
          showToast('🔔 No new alerts right now. Check back later!');
        }
        return;
      }
      
      if (page === 'cart') {
        const cart = getCartUtil();
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
        } else if (page === 'cart') {
          showToast('Do we have everything? Let\'s check and make sure!');
          const icon = item.querySelector('i');
          if (icon) {
            icon.classList.add('cart-blink');
            setTimeout(() => icon.classList.remove('cart-blink'), 2000);
          }
        } else if (page === 'orders') {
          showToast('Track your orders here.');
        } else if (page === 'account') {
          showToast('Manage your account.');
        } else if (page === 'notifications') {
          showToast('🔔 No new alerts right now. Check back later!');
        }
        return;
      }
      
      if (page === 'home') window.location.href = '/index';
      else if (page === 'cart') window.location.href = '/cart';
      else if (page === 'orders') window.location.href = '/my-orders';
      else if (page === 'account') {
        if (auth.currentUser) {
          window.location.href = '/account';
        } else {
          openAuthModal();
        }
      } else if (page === 'notifications') {
        window.location.href = '/notifications';
      }
    });
  });
}

// ============================================================
//  DESKTOP NAVIGATION (unchanged)
// ============================================================
export function initDesktopNav() {
  const desktopCartBtn = document.getElementById('desktopCartBtn');
  if (desktopCartBtn) {
    desktopCartBtn.addEventListener('click', (e) => {
      const cart = getCartUtil();
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
    desktopNotifyBtn.addEventListener('click', () => {
      const count = getUnreadNotificationCount();
      if (count > 0) {
        window.location.href = '/notifications';
      } else {
        showToast('🔔 No new alerts right now. Check back later!');
      }
    });
  }
  
  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    authBtn.addEventListener('click', () => {
      if (auth.currentUser) {
        window.location.href = '/account';
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
//  SERVICE WORKER REGISTRATION (UPDATED – async & waits for SWs)
// ============================================================
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('⚠️ Service workers not supported');
    return null;
  }

  try {
    // Register main SW (caching)
    const mainReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('✅ Main SW registered:', mainReg);

    // Register FCM SW (push)
    const fcmReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    console.log('✅ FCM SW registered:', fcmReg);

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    console.log('✅ All service workers ready');
    return fcmReg;
  } catch (error) {
    console.error('❌ Service worker registration failed:', error);
    return null;
  }
}

// ============================================================
//  FCM PUSH SUBSCRIPTION (UPDATED – uses service worker readiness)
// ============================================================
export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('🔕 Push not supported');
    return;
  }

  try {
    // Ensure service worker is ready
    const registration = await navigator.serviceWorker.ready;
    if (!registration) {
      console.warn('🔕 No service worker registration');
      return;
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('🔕 Notification permission denied');
      return;
    }

    // Get the FCM messaging instance
    const messaging = getMessaging();
    
    // Get the FCM token (VAPID key from Firebase Console)
    const token = await getToken(messaging, {
      vapidKey: 'BFiovOEAOgZUXWJgo6h5bCw-MgoJmdZTyCjfGpy5EhArqnOlkQjkMjukgh_I74Z0A48XWNQWKy4_xeOAaCj6XMI'
    });

    if (!token) {
      console.warn('🔕 No FCM token received');
      return;
    }

    // Save token to Firestore
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

    // Listen for foreground messages
    onMessage(messaging, (payload) => {
      console.log('📨 Foreground message:', payload);
      const title = payload.notification?.title || 'Ghost Shopper';
      const body = payload.notification?.body || 'You have a new notification';
      showToast(`🔔 ${title}: ${body}`);
    });

  } catch (error) {
    console.error('❌ FCM subscribe error:', error);
    if (error.name === 'AbortError') {
      console.warn('🔕 Subscription aborted – service worker may not be ready. Retrying...');
      // Retry after 2 seconds
      setTimeout(() => subscribeToPush(), 2000);
    }
  }
}

/**
 * Unsubscribe the current user from push notifications.
 * Removes the FCM token from Firestore.
 */
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

// ============================================================
//  TOGGLE NOTIFICATIONS
// ============================================================
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
//  INIT FUNCTION – Call this ONCE per page (now async)
// ============================================================
export async function initGlobal() {
  // Guard: Do not run customer nav logic on the admin page
  if (window.location.pathname.includes('/admin/')) {
    console.log('Admin page detected - skipping global nav logic');
    return;
  }

  initPWA();
  initAuthModal();
  initLegalModals();
  initCookieConsent();
  
  // Register service workers and wait for them
  await registerServiceWorker();
  
  updateBadge();
  updateNotificationBadge();
  
  // Auto-subscribe to push if user is signed in (give SW extra time)
  if (auth.currentUser) {
    setTimeout(() => subscribeToPush(), 3000);
  }

  // Address search after DOM ready
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
}

// ============================================================
//  EXPOSE TO WINDOW FOR INLINE HTML CALLS
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
// Expose push functions
window.subscribeToPush = subscribeToPush;
window.unsubscribeFromPush = unsubscribeFromPush;
// Expose to window
window.toggleNotifications = toggleNotifications;