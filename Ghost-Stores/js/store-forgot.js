// js/store-forgot.js — Password reset email

import { auth, sendPasswordResetEmail } from './firebase-config.js';

const form = document.getElementById('forgotForm');
const msg = document.getElementById('forgotMessage');
const btn = document.getElementById('resetBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'gs-message';
  msg.textContent = '';

  const email = form.email.value.trim().toLowerCase();
  if (!email) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';

  try {
    await sendPasswordResetEmail(auth, email);
    // Do not leak whether the email exists — always same message
    msg.className = 'gs-message success';
    msg.textContent = 'If an account exists for that email, you’ll receive a reset link shortly.';
    form.reset();
  } catch (err) {
    console.error('forgot error:', err);
    const code = err?.code || '';
    if (code === 'auth/user-not-found') {
      // Still show success to avoid leaking account existence
      msg.className = 'gs-message success';
      msg.textContent = 'If an account exists for that email, you’ll receive a reset link shortly.';
    } else if (code === 'auth/invalid-email') {
      msg.className = 'gs-message error';
      msg.textContent = 'That email address doesn’t look right.';
    } else {
      msg.className = 'gs-message error';
      msg.textContent = err?.message || 'Something went wrong. Please try again.';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send reset link';
  }
});