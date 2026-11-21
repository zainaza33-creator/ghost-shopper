// ============================================================
//  driver-forgot-password.js
// ============================================================

import { auth, db } from './firebase-config.js';
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const forgotForm = document.getElementById('forgotPasswordForm');
const emailInput = document.getElementById('email');
const resetBtn = document.getElementById('resetBtn');
const authStatus = document.getElementById('authStatus');

if (forgotForm) {
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();

    resetBtn.disabled = true;
    resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    showStatus('', '');

    try {
      // 1. Check if this email exists in our drivers collection
      const q = query(collection(db, 'drivers'), where('email', '==', email));
      const snap = await getDocs(q);

      if (snap.empty) {
        showStatus('No driver account found with this email.', 'error');
        resetBtn.disabled = false;
        resetBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
        return;
      }

      // 2. Send Reset Email
      await sendPasswordResetEmail(auth, email);
      
      showStatus('✅ Reset link sent! Check your inbox (and spam folder).', 'success');
      resetBtn.innerHTML = '<i class="fas fa-check"></i> Sent';
      
    } catch (error) {
      console.error('Forgot password error:', error);
      showStatus('Could not send reset email. Please try again.', 'error');
      resetBtn.disabled = false;
      resetBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
    }
  });
}

function showStatus(msg, type) {
  if (!authStatus) return;
  authStatus.textContent = msg;
  authStatus.className = 'driver-status ' + (type || '');
  authStatus.style.display = msg ? 'block' : 'none';
}