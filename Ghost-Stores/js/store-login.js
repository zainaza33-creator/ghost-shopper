// js/store-login.js — Email/password login with remember-me

import {
  auth, db,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence,
  doc, getDoc
} from './firebase-config.js';

const form = document.getElementById('loginForm');
const msg = document.getElementById('loginMessage');
const btn = document.getElementById('loginBtn');

// Show message based on URL params (e.g. when logged out from dashboard)
const urlParams = new URLSearchParams(window.location.search);
const reason = urlParams.get('reason');
if (reason === 'verify') {
  msg.className = 'gs-message error';
  msg.textContent = 'Please verify your email before signing in.';
} else if (reason === 'suspended') {
  msg.className = 'gs-message error';
  msg.textContent = 'Your account has been suspended. Please contact support.';
} else if (reason === 'notstore') {
  msg.className = 'gs-message error';
  msg.textContent = 'This portal is for store accounts only.';
}

// Restore "remember me" checkbox from localStorage hint
const rememberInput = document.getElementById('rememberMe');
if (rememberInput) {
  const remembered = localStorage.getItem('gs_remember_email');
  if (remembered) {
    rememberInput.checked = true;
    if (form && form.email) form.email.value = remembered;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'gs-message';
  msg.textContent = '';

  const email = form.email.value.trim().toLowerCase();
  const password = form.password.value;
  const remember = rememberInput?.checked === true;

  if (!email || !password) {
    msg.className = 'gs-message error';
    msg.textContent = 'Please enter both email and password.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…';

  try {
    const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistence);

    const cred = await signInWithEmailAndPassword(auth, email, password);

    if (!cred.user.emailVerified) {
      await signOut(auth);
      msg.className = 'gs-message error';
      msg.textContent = 'Please verify your email first. Check your inbox for the verification link.';
      return;
    }

    const userSnap = await getDoc(doc(db, 'users', cred.user.uid));
    if (!userSnap.exists()) {
      await signOut(auth);
      msg.className = 'gs-message error';
      msg.textContent = 'No store account found for this email. Please contact support.';
      return;
    }
    
    const userData = userSnap.data();
    if (userData.role !== 'store') {
      await signOut(auth);
      msg.className = 'gs-message error';
      msg.textContent = 'This portal is for store accounts only.';
      return;
    }

    if (remember) {
      localStorage.setItem('gs_remember_email', email);
    } else {
      localStorage.removeItem('gs_remember_email');
    }

    window.location.replace('dashboard.html');
  } catch (err) {
    console.error('login error:', err);
    msg.className = 'gs-message error';
    msg.textContent = friendlyAuthError(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in';
  }
});

function friendlyAuthError(err) {
  const code = err?.code || '';
  if (code === 'auth/invalid-email') return 'That email address doesn’t look right.';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential')
    return 'Incorrect email or password.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Please check your connection.';
  return err?.message || 'Something went wrong. Please try again.';
}