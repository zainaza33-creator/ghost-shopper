import { auth, db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const registerForm = document.getElementById('registerForm');
const firstNameInput = document.getElementById('firstName');
const lastNameInput = document.getElementById('lastName');
const emailInput = document.getElementById('email');
const phoneInput = document.getElementById('phone');
const passwordInput = document.getElementById('password');
const agreeTerms = document.getElementById('agreeTerms');
const registerBtn = document.getElementById('registerBtn');
const authStatus = document.getElementById('authStatus');
const togglePassword = document.getElementById('togglePassword');

// Verification View Elements
const registerFormView = document.getElementById('registerFormView');
const verifyEmailView = document.getElementById('verifyEmailView');
const verifyGreeting = document.getElementById('verifyGreeting');
const verifyEmailDisplay = document.getElementById('verifyEmailDisplay');
const verifyStatus = document.getElementById('verifyStatus');
const resendEmailBtn = document.getElementById('resendEmailBtn');
const goToLoginBtn = document.getElementById('goToLoginBtn');

if (togglePassword) {
  togglePassword.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    togglePassword.innerHTML = type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
  });
}

if (firstNameInput) {
  firstNameInput.addEventListener('input', () => {
    firstNameInput.value = firstNameInput.value.replace(/[^a-zA-Z\s]/g, '');
  });
}
if (lastNameInput) {
  lastNameInput.addEventListener('input', () => {
    lastNameInput.value = lastNameInput.value.replace(/[^a-zA-Z\s]/g, '');
  });
}
if (phoneInput) {
  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 9); 
    if (phoneInput.value.startsWith('0')) {
      phoneInput.value = phoneInput.value.substring(1);
    }
  });
}

// Resend Button Logic
if (resendEmailBtn) {
  resendEmailBtn.addEventListener('click', async () => {
    if (!auth.currentUser) return;
    resendEmailBtn.disabled = true;
    resendEmailBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    verifyStatus.textContent = '';
    try {
      await sendEmailVerification(auth.currentUser);
      verifyStatus.textContent = '✅ Verification email resent! Check your inbox and spam folder.';
      verifyStatus.style.color = 'var(--green)';
    } catch (err) {
      console.error(err);
      verifyStatus.textContent = '❌ Could not resend email. Please wait a few minutes and try again.';
      verifyStatus.style.color = 'var(--red)';
    }
    resendEmailBtn.disabled = false;
    resendEmailBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Resend Verification Link';
  });
}

// Go to Login Button Logic
if (goToLoginBtn) {
  goToLoginBtn.addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = 'driver-login.html';
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const email = emailInput.value.trim();
    const phone = '+27' + phoneInput.value.trim();
    const password = passwordInput.value;

    if (!agreeTerms.checked) {
      showStatus('You must agree to the Terms & Conditions to register.', 'error');
      return;
    }

    registerBtn.disabled = true;
    registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    showStatus('', '');

    try {
      // 1. Create Auth User
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Send Email Verification
      await sendEmailVerification(user);

      // 3. Update Auth Profile
      await updateProfile(user, { displayName: `${firstName} ${lastName}` });

      // 4. Create Driver Document (using UID)
      await setDoc(doc(db, 'drivers', user.uid), {
        uid: user.uid,
        firstName: firstName,
        lastName: lastName,
        name: `${firstName} ${lastName}`,
        email: email,
        phone: phone,
        role: 'driver',
        
        approved: false,
        suspended: false,
        emailVerified: false,
        
        vehicleReg: '',
        licenseNumber: '',
        bankName: '',
        bankAccountName: '',
        bankAccountNumber: '',
        profilePhoto: '',
        vehiclePhoto: '',
        licensePhoto: '',
        idDoc: '',
        bankConfirmationPdfUrl: '',
        bankEmailSent: false,
        area: '',
        rating: 0,
        reviewCount: 0,
        totalEarnings: 0,
        paidEarnings: 0,
        needsReview: false,
        
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 5. Switch to Verification View
      registerFormView.style.display = 'none';
      verifyEmailView.style.display = 'block';
      
      // 6. Personalize the Message
      verifyGreeting.textContent = `Hi ${firstName}!`;
      verifyEmailDisplay.textContent = email;
      
    } catch (error) {
      console.error('Registration error:', error);
      let msg = 'Could not register. Please try again.';
      if (error.code === 'auth/email-already-in-use') msg = 'This email is already registered. Try logging in.';
      if (error.code === 'auth/weak-password') msg = 'Password should be at least 6 characters.';
      if (error.code === 'permission-denied') msg = 'Database error. Please contact support (Check Firestore Rules).';
      
      showStatus(msg, 'error');
      registerBtn.disabled = false;
      registerBtn.innerHTML = '<i class="fas fa-user-plus"></i> Register';
    }
  });
}

function showStatus(msg, type) {
  if (!authStatus) return;
  authStatus.textContent = msg;
  authStatus.className = 'driver-status ' + (type || '');
  authStatus.style.display = msg ? 'block' : 'none';
}