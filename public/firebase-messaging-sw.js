// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

// Firebase config (same as your env)
const firebaseConfig = {
  apiKey: "AIzaSyBnYQqVzQTdbhjd2bXKKqvKkSIc4XGpwSw",
  authDomain: "ghostshopza.firebaseapp.com",
  projectId: "ghostshopza",
  storageBucket: "ghostshopza.firebasestorage.app",
  messagingSenderId: "473222699760",
  appId: "1:473222699760:web:3c0f791cd90cd823868035"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('📨 Background message:', payload);
  const notificationTitle = payload.notification?.title || 'Ghost Shopper';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new update',
    icon: '/img/ghost-shopper-logo.png',
    badge: '/img/favicon.png',
    data: payload.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click (same as before)
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.openWindow(url)
  );
});