import { auth, db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const rememberMe = document.getElementById('rememberMe');
const loginBtn = document.getElementById('loginBtn');
const authStatus = document.getElementById('authStatus');
const togglePassword = document.getElementById('togglePassword');

if (togglePassword) {
  togglePassword.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    togglePassword.innerHTML = type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const persist = rememberMe.checked ? browserLocalPersistence : browserSessionPersistence;

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing In...';
    showStatus('', '');

    try {
      await setPersistence(auth, persist);

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 1. Block Unverified Emails
      if (!user.emailVerified) {
        await auth.signOut();
        showStatus('⚠️ Please verify your email before logging in. Check your inbox and spam folder.', 'verifying');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        return;
      }

      // 2. Check Driver Document
      const driverSnap = await getDoc(doc(db, 'drivers', user.uid));
      
      if (!driverSnap.exists()) {
        await auth.signOut();
        showStatus('Driver account not found. Please register.', 'error');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        return;
      }

      const driverData = driverSnap.data();
      if (driverData.suspended) {
        await auth.signOut();
        showStatus('Your account is suspended. Contact admin.', 'error');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        return;
      }

      showStatus('✅ Signed in! Redirecting...', 'success');
      setTimeout(() => {
        window.location.href = 'driver-dashboard.html';
      }, 1000);

    } catch (error) {
      console.error('Login error:', error);
      let msg = 'Could not sign in. Please check your email and password.';
      if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') msg = 'Invalid email or password.';
      if (error.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later.';
      showStatus(msg, 'error');
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
    }
  });
}

function showStatus(msg, type) {
  if (!authStatus) return;
  authStatus.textContent = msg;
  authStatus.className = 'driver-status ' + (type || '');
  authStatus.style.display = msg ? 'block' : 'none';
}