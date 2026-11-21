// js/store-home.js — Logic for the Ghost Stores landing page

// ============================================================
//  SLIDER LOGIC
// ============================================================
const slides = document.querySelectorAll('.gs-slide');
const dots = document.querySelectorAll('.gs-dot');
let currentSlide = 0;
let slideInterval;

function goToSlide(index) {
  slides.forEach(s => s.classList.remove('active'));
  dots.forEach(d => d.classList.remove('active'));
  
  slides[index].classList.add('active');
  dots[index].classList.add('active');
  currentSlide = index;
}

function nextSlide() {
  let next = currentSlide + 1;
  if (next >= slides.length) next = 0;
  goToSlide(next);
}

function startSlider() {
  slideInterval = setInterval(nextSlide, 5000);
}

function stopSlider() {
  clearInterval(slideInterval);
}

dots.forEach((dot, index) => {
  dot.addEventListener('click', () => {
    stopSlider();
    goToSlide(index);
    startSlider();
  });
});

startSlider();

// ============================================================
//  MOBILE NAV TOGGLE
// ============================================================
const mobileToggle = document.getElementById('accessBtn');
const mobileDropdown = document.getElementById('mobileDropdown');
const mobileNavWrapper = document.getElementById('mobileNavToggle');

if (mobileToggle) {
  mobileToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    mobileDropdown.classList.toggle('active');
  });
  
  document.addEventListener('click', (e) => {
    if (!mobileNavWrapper.contains(e.target)) {
      mobileDropdown.classList.remove('active');
    }
  });
}

// ============================================================
//  SCROLL HEADER
// ============================================================
const nav = document.getElementById('homeNav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    nav.classList.add('gs-nav-scrolled');
  } else {
    nav.classList.remove('gs-nav-scrolled');
  }
});

// ============================================================
//  HOW IT WORKS MODALS
// ============================================================
const modalData = {
  1: {
    icon: '<i class="fas fa-file-signature"></i>',
    title: 'Register your store',
    desc: 'To get started, click the <strong>Register</strong> button and fill in the form. You will need to provide your store name, area, your personal contact details, and a secure password. Once you submit the form, your application goes directly to our admin team for review.'
  },
  2: {
    icon: '<i class="fas fa-check-circle"></i>', /* Fixed icon here too */
    title: 'Verification & Approval',
    desc: 'To keep Ghost Shopper safe, our team manually reviews every application. We may phone you to confirm that you are the legitimate owner of the store. Once verified, your owner account is approved, and you can log in to your dashboard.'
  },
  3: {
    icon: '<i class="fas fa-box-open"></i>',
    title: 'Build your storefront',
    desc: 'Log in to your dashboard to add your logo, upload trading hours, and start adding your products. You can set prices, add descriptions, and even create weekly specials that run for a specific time.'
  },
  4: {
    icon: '<i class="fas fa-globe"></i>',
    title: 'Go Live & Deliver',
    desc: 'Once your profile is complete, our admin team reviews it one final time. When approved, your store is published live on the Ghost Shopper app. Customers can browse, add to cart, and a local driver will collect and deliver the order.'
  }
};

const stepModal = document.getElementById('stepModal');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');
const closeModal = document.getElementById('closeModal');
const gotItBtn = document.getElementById('modalGotItBtn');

// Expose this globally so the inline onclick on the cards can call it
window.openStepModal = function(step) {
  const data = modalData[step];
  if (data) {
    modalIcon.innerHTML = data.icon;
    modalTitle.textContent = data.title;
    modalDesc.innerHTML = data.desc;
    stepModal.classList.add('active');
  }
};

function closeStepModal() {
  stepModal.classList.remove('active');
}

closeModal.addEventListener('click', closeStepModal);
gotItBtn.addEventListener('click', closeStepModal);
stepModal.addEventListener('click', (e) => {
  if (e.target === stepModal) closeStepModal();
});

// ============================================================
//  BACK TO TOP
// ============================================================
const backToTopBtn = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
  if (window.scrollY > 300) {
    backToTopBtn.classList.add('show');
  } else {
    backToTopBtn.classList.remove('show');
  }
});

backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});