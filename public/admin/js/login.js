// ============================================================
//  login.js — Admin email + password login
//  Uses Firebase Auth signInWithEmailAndPassword.
//  Verifies users/{uid}.role === 'admin' before redirecting.
// ============================================================

console.log('🚀 admin login.js booting...');

import { auth, db } from '../../js/firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ===== DOM =====
const form           = document.getElementById('adminLoginForm');
const emailInput     = document.getElementById('adminEmail');
const passwordInput  = document.getElementById('adminPassword');
const loginBtn       = document.getElementById('adminLoginBtn');
const togglePwBtn    = document.getElementById('togglePassword');
const statusEl       = document.getElementById('adminLoginStatus');

// ===== Helpers =====
function setStatus(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.className = 'admin-login-status' + (kind ? ' ' + kind : '');
}

function setLoading(loading) {
  loginBtn.disabled = loading;
  if (loading) {
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Signing in...</span>';
  } else {
    loginBtn.innerHTML = '<span>Sign In</span> <i class="fas fa-arrow-right" aria-hidden="true"></i>';
  }
}

// ===== Show / hide password =====
togglePwBtn?.addEventListener('click', () => {
  const isPw = passwordInput.type === 'password';
  passwordInput.type = isPw ? 'text' : 'password';
  togglePwBtn.innerHTML = isPw
    ? '<i class="fas fa-eye-slash" aria-hidden="true"></i>'
    : '<i class="fas fa-eye" aria-hidden="true"></i>';
  togglePwBtn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
});

// ===== If already signed in as admin, skip straight to panel =====
auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists() && userDoc.data().role === 'admin') {
      window.location.replace('admin.html');
    } else {
      // Signed in but not admin — sign out and show a message
      await signOut(auth);
      setStatus('That account is not an admin. Please use your admin email.', 'error');
    }
  } catch (err) {
    console.warn('Auth state check failed:', err);
  }
});

// ===== Sign in =====
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !email.includes('@')) {
    setStatus('Please enter a valid email address.', 'error');
    emailInput.focus();
    return;
  }
  if (!password) {
    setStatus('Please enter your password.', 'error');
    passwordInput.focus();
    return;
  }

  setStatus('Signing in...', 'verifying');
  setLoading(true);

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    // Verify role = admin
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (!userDoc.exists()) {
      await signOut(auth);
      setStatus('No user record found for this account.', 'error');
      setLoading(false);
      return;
    }

    const role = userDoc.data().role || 'customer';
    if (role !== 'admin') {
      await signOut(auth);
      setStatus('That account is not an admin.', 'error');
      setLoading(false);
      return;
    }

    setStatus('Signed in. Redirecting...', 'success');
    setTimeout(() => {
      window.location.replace('admin.html');
    }, 500);

  } catch (err) {
    console.error('Admin login error:', err);

    let msg = 'Sign in failed. Please try again.';
    switch (err.code) {
      case 'auth/invalid-email':
        msg = 'That email address is not valid.';
        break;
      case 'auth/user-not-found':
        msg = 'No admin account found with that email.';
        break;
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        msg = 'Incorrect email or password.';
        break;
      case 'auth/too-many-requests':
        msg = 'Too many failed attempts. Please try again in a few minutes.';
        break;
      case 'auth/network-request-failed':
        msg = 'Network error. Check your connection and try again.';
        break;
      case 'auth/user-disabled':
        msg = 'This account has been disabled.';
        break;
    }
    setStatus(msg, 'error');
    setLoading(false);
  }
});
