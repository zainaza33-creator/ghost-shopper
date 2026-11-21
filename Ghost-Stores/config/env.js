// config/env.js — Ghost Stores environment
// Same Firebase project as the customer site (ghostshopza)

window.__ENV = {
  FIREBASE: {
    apiKey: "AIzaSyBnYQqVzQTdbhjd2bXKKqvKkSIc4XGpwSw",
    authDomain: "ghostshopza.firebaseapp.com",
    projectId: "ghostshopza",
    storageBucket: "ghostshopza.firebasestorage.app",
    messagingSenderId: "473222699760",
    appId: "1:473222699760:web:3c0f791cd90cd823868035"
  },
  APP: {
    NAME: 'Ghost Stores',
    VERSION: '1.0.4',
    ENVIRONMENT: 'production'
  }
};

console.log(`🚀 ${window.__ENV.APP.NAME} v${window.__ENV.APP.VERSION} loaded`);