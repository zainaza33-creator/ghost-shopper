// config/env.js
// ============================================================
// ENVIRONMENT CONFIGURATION
// This file contains all API keys and configuration
// ============================================================

// ===== WARNING: NEVER COMMIT THIS FILE WITH REAL KEYS TO GITHUB! =====
// Use environment variables in production

window.__ENV = {
  // ===== FIREBASE CONFIG =====
  FIREBASE: {
    apiKey: "AIzaSyBnYQqVzQTdbhjd2bXKKqvKkSIc4XGpwSw",
    authDomain: "ghostshopza.firebaseapp.com",
    projectId: "ghostshopza",
    storageBucket: "ghostshopza.firebasestorage.app",
    messagingSenderId: "473222699760",
    appId: "1:473222699760:web:3c0f791cd90cd823868035"
  },
  
  // ===== GOOGLE MAPS API KEY =====
  // IMPORTANT: Restrict this key in Google Cloud Console to your domain!
  GOOGLE_MAPS_API_KEY: "AIzaSyCgDysjnDzVdCjNnyCWBTO9DhUXnBUqAN0",
  
  // ===== APP CONFIGURATION =====
  APP: {
    NAME: 'Ghost Shopper',
    VERSION: '2.0.0',
    ENVIRONMENT: 'development', // 'development' | 'production'
    DELIVERY_FEE: 35,
    MIN_ORDER_AMOUNT: 1,
    CURRENCY: 'ZAR'
  }
};

// ===== VALIDATION =====
// Check if all required config is present
const requiredKeys = ['apiKey', 'authDomain', 'projectId'];
const missingKeys = requiredKeys.filter(key => !window.__ENV.FIREBASE[key]);

if (missingKeys.length > 0) {
  console.error(`❌ Missing Firebase config keys: ${missingKeys.join(', ')}`);
}

console.log(`🚀 ${window.__ENV.APP.NAME} v${window.__ENV.APP.VERSION} loaded (${window.__ENV.APP.ENVIRONMENT} mode)`);