import { db } from './firebase-config.js';
import { 
  addDoc, 
  collection, 
  serverTimestamp, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  query, 
  where, 
  getDocs,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const SESSION_KEY = 'ghostShopperSessionId';
const SESSION_EXPIRY = 30 * 60 * 1000; // 30 minutes
const ABANDONMENT_THRESHOLD = 30 * 60 * 1000; // 30 minutes

class AnalyticsService {
  constructor() {
    this.sessionId = this.getOrCreateSession();
    this.userId = null;
    this.userPhone = null;
    this.userName = null;
    this.pageStartTime = Date.now();
    this.lastActive = new Date();
    this.cartId = null;
    
    // Track page view on load
    this.trackPageView();
    
    // Update session activity periodically (safely)
    this.sessionInterval = setInterval(() => {
      this.updateSession().catch(() => {}); 
    }, 30000);
    
    this.startAbandonedCartMonitoring();
    
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.updateSession().catch(() => {});
        this.lastActive = new Date();
      }
    });
  }

  // ===== Session Management =====
  getOrCreateSession() {
    let sessionId = localStorage.getItem(SESSION_KEY);
    const sessionStart = localStorage.getItem('ghostShopperSessionStart');
    
    if (sessionId && sessionStart) {
      const elapsed = Date.now() - parseInt(sessionStart);
      if (elapsed < SESSION_EXPIRY) {
        this.updateSession().catch(() => {});
        return sessionId;
      }
    }
    
    sessionId = 'ses_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.setItem('ghostShopperSessionStart', Date.now().toString());
    this.createSession(sessionId).catch(() => {});
    return sessionId;
  }

  async createSession(sessionId) {
    try {
      await setDoc(doc(db, 'analytics_sessions', sessionId), {
        sessionId: sessionId,
        startTime: serverTimestamp(),
        lastActive: serverTimestamp(),
        pages: [this.getCleanPath()],
        userAgent: navigator.userAgent,
        referrer: document.referrer || ''
      });
    } catch (error) {
      console.debug('Analytics session create error:', error);
    }
  }

  async updateSession() {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return;
    try {
      const docRef = doc(db, 'analytics_sessions', sessionId);
      await updateDoc(docRef, {
        lastActive: serverTimestamp(),
        pages: this.getPages()
      });
    } catch (error) {
      if (error.code === 'not-found') {
        await this.createSession(sessionId);
      } else {
        // Silently fail on permission errors so the console stays clean
        console.debug('Analytics session update ignored:', error.message);
      }
    }
  }

  getCleanPath() {
    // Handles /store/golden-gate -> /store/golden-gate
    return window.location.pathname;
  }

  getPages() {
    const pages = [];
    const stored = localStorage.getItem('ghostShopperPages');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) pages.push(...parsed);
      } catch (e) {}
    }
    const currentPath = this.getCleanPath();
    if (!pages.includes(currentPath)) {
      pages.push(currentPath);
      localStorage.setItem('ghostShopperPages', JSON.stringify(pages));
    }
    return pages;
  }

  // ===== Abandoned Cart Monitoring =====
  startAbandonedCartMonitoring() {
    setInterval(() => {
      this.checkAbandonedCarts().catch(() => {});
    }, 60000);
    
    window.addEventListener('beforeunload', () => {
      this.checkCartAbandonment().catch(() => {});
    });
  }

  async checkAbandonedCarts() {
    const thirtyMinsAgo = new Date(Date.now() - ABANDONMENT_THRESHOLD);
    const cartsRef = collection(db, 'abandoned_carts');
    const q = query(
      cartsRef,
      where('status', '==', 'active'),
      where('lastActivity', '<', thirtyMinsAgo)
    );
    
    try {
      const snapshot = await getDocs(q);
      snapshot.forEach(async (docSnap) => {
        const data = docSnap.data();
        if (data.items && data.items.length > 0) {
          await updateDoc(docSnap.ref, {
            status: 'abandoned',
            abandonedAt: serverTimestamp()
          }).catch(() => {});
        }
      });
    } catch (e) {
      // Ignore permissions errors on background checks
    }
  }

  async checkCartAbandonment() {
    if (!this.cartId) return;
    try {
      const cartRef = doc(db, 'abandoned_carts', this.cartId);
      const cartSnap = await getDoc(cartRef);
      if (cartSnap.exists()) {
        const data = cartSnap.data();
        if (data.status === 'active' && data.items && data.items.length > 0) {
          await updateDoc(cartRef, {
            status: 'abandoned',
            abandonedAt: serverTimestamp()
          });
        }
      }
    } catch (error) {
      console.debug('Analytics cart abandonment error:', error.message);
    }
  }

  // ===== Cart Tracking =====
  async trackCart(cartItems, subtotal, storeId, storeName) {
    if (!cartItems || cartItems.length === 0) {
      if (this.cartId) {
        try {
          const cartRef = doc(db, 'abandoned_carts', this.cartId);
          await updateDoc(cartRef, {
            status: 'emptied',
            items: [],
            subtotal: 0
          });
          this.cartId = null;
        } catch (e) {}
      }
      return;
    }

    try {
      const cartsRef = collection(db, 'abandoned_carts');
      const q = query(
        cartsRef,
        where('sessionId', '==', this.sessionId),
        where('status', 'in', ['active', 'abandoned'])
      );
      const snapshot = await getDocs(q);
      
      const userId = this.userId || null;
      const userPhone = this.userPhone || null;
      const userName = this.userName || null;
      
      if (!snapshot.empty) {
        const docRef = snapshot.docs[0];
        this.cartId = docRef.id;
        await updateDoc(docRef, {
          items: cartItems,
          subtotal: subtotal || 0,
          storeId: storeId || null,
          storeName: storeName || 'Unknown',
          userId: userId || null,
          userPhone: userPhone || null,
          userName: userName || null,
          lastActivity: serverTimestamp(),
          status: 'active',
          updatedAt: serverTimestamp()
        });
      } else {
        const cartData = {
          sessionId: this.sessionId,
          userId: userId || null,
          userPhone: userPhone || null,
          userName: userName || null,
          items: cartItems,
          subtotal: subtotal || 0,
          storeId: storeId || null,
          storeName: storeName || 'Unknown',
          status: 'active',
          lastActivity: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          abandonedAt: null,
          convertedAt: null
        };
        const docRef = await addDoc(collection(db, 'abandoned_carts'), cartData);
        this.cartId = docRef.id;
      }
    } catch (error) {
      console.debug('Analytics cart tracking error:', error.message);
    }
  }

  async trackCartConverted() {
    if (!this.cartId) return;
    try {
      const cartRef = doc(db, 'abandoned_carts', this.cartId);
      await updateDoc(cartRef, {
        status: 'converted',
        convertedAt: serverTimestamp()
      });
      this.cartId = null;
    } catch (error) {
      console.debug('Analytics cart converted error:', error.message);
    }
  }

  setUserId(userId, phone, name) {
    this.userId = userId;
    this.userPhone = phone || null;
    this.userName = name || null;
    if (this.cartId) {
      try {
        const cartRef = doc(db, 'abandoned_carts', this.cartId);
        updateDoc(cartRef, { 
          userId: userId,
          userPhone: this.userPhone,
          userName: this.userName
        }).catch(() => {});
      } catch (e) {}
    }
  }

  // ===== Tracking Events =====
  
  async trackPageView() {
    const pageData = {
      page: this.getCleanPath(),
      sessionId: this.sessionId,
      userId: this.userId || null,
      timestamp: serverTimestamp(),
      referrer: document.referrer || '',
      userAgent: navigator.userAgent,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      language: navigator.language
    };

    // Clean URL support for store pages
    if (window.location.pathname.includes('/store/')) {
      pageData.storeId = window.location.pathname.split('/')[2];
    } else {
      const params = new URLSearchParams(window.location.search);
      if (params.get('id')) pageData.storeId = params.get('id');
    }

    try {
      await addDoc(collection(db, 'analytics_page_views'), pageData);
    } catch (error) {}
  }

  async trackProductView(productId, productName, storeId, storeName, source) {
    try {
      await addDoc(collection(db, 'analytics_product_views'), {
        productId: productId,
        productName: productName || 'Unknown',
        storeId: storeId || null,
        storeName: storeName || 'Unknown',
        userId: this.userId || null,
        sessionId: this.sessionId,
        source: source || 'store-page',
        timestamp: serverTimestamp()
      });
    } catch (error) {}
  }

  async trackAddToCart(productId, productName, storeId, storeName, price, quantity = 1, cartItems = null, subtotal = null) {
    try {
      await addDoc(collection(db, 'analytics_product_added'), {
        productId: productId,
        productName: productName || 'Unknown',
        storeId: storeId || null,
        storeName: storeName || 'Unknown',
        userId: this.userId || null,
        sessionId: this.sessionId,
        price: price || 0,
        quantity: quantity,
        timestamp: serverTimestamp()
      });
      
      if (cartItems) {
        await this.trackCart(cartItems, subtotal, storeId, storeName);
      }
    } catch (error) {}
  }

  async trackStoreView(storeId, storeName) {
    try {
      await addDoc(collection(db, 'analytics_store_views'), {
        storeId: storeId,
        storeName: storeName || 'Unknown',
        userId: this.userId || null,
        sessionId: this.sessionId,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.debug('Analytics store view error:', error.message);
    }
  }

  async trackFlyerView(flyerId, storeId, storeName) {
    try {
      await addDoc(collection(db, 'analytics_flyer_views'), {
        flyerId: flyerId,
        storeId: storeId || null,
        storeName: storeName || 'Unknown',
        userId: this.userId || null,
        sessionId: this.sessionId,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.debug('Analytics flyer view error:', error.message);
    }
  }

  async trackSpecialView(specialId, specialName, storeId, storeName) {
    try {
      await addDoc(collection(db, 'analytics_special_views'), {
        specialId: specialId,
        specialName: specialName || 'Unknown',
        storeId: storeId || null,
        storeName: storeName || 'Unknown',
        userId: this.userId || null,
        sessionId: this.sessionId,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.debug('Analytics special view error:', error.message);
    }
  }

  async trackCheckoutStarted() {
    try {
      await addDoc(collection(db, 'analytics_checkout_started'), {
        userId: this.userId || null,
        sessionId: this.sessionId,
        timestamp: serverTimestamp()
      });
    } catch (error) {}
  }

  async getAnalyticsStats() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const cartsRef = collection(db, 'abandoned_carts');
      
      const abandonedQuery = query(
        cartsRef,
        where('status', '==', 'abandoned'),
        where('abandonedAt', '>', thirtyDaysAgo)
      );
      const abandonedSnap = await getDocs(abandonedQuery);
      
      const convertedQuery = query(
        cartsRef,
        where('status', '==', 'converted'),
        where('convertedAt', '>', thirtyDaysAgo)
      );
      const convertedSnap = await getDocs(convertedQuery);
      
      const activeQuery = query(
        cartsRef,
        where('status', '==', 'active'),
        where('lastActivity', '>', thirtyDaysAgo)
      );
      const activeSnap = await getDocs(activeQuery);

      const fiveMinsAgo = new Date();
      fiveMinsAgo.setMinutes(fiveMinsAgo.getMinutes() - 5);
      const onlineQuery = query(
        collection(db, 'analytics_sessions'),
        where('lastActive', '>', fiveMinsAgo)
      );
      const onlineSnap = await getDocs(onlineQuery);

      const ordersSnap = await getDocs(collection(db, 'orders'));
      const orders = ordersSnap.docs.map(doc => doc.data());
      const completedOrders = orders.filter(o => o.orderStatus === 'delivered' || o.paymentStatus === 'paid');
      const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      return {
        abandonedCount: abandonedSnap.size,
        convertedCount: convertedSnap.size,
        activeCount: activeSnap.size,
        onlineUsers: onlineSnap.size,
        totalOrders: orders.length,
        completedOrders: completedOrders.length,
        totalRevenue,
        conversionRate: (abandonedSnap.size + convertedSnap.size) > 0 
          ? ((convertedSnap.size / (abandonedSnap.size + convertedSnap.size)) * 100).toFixed(1) 
          : 0
      };
    } catch (error) {
      console.error('Error getting analytics stats:', error);
      return {
        abandonedCount: 0, convertedCount: 0, activeCount: 0,
        onlineUsers: 0, totalOrders: 0, completedOrders: 0,
        totalRevenue: 0, conversionRate: 0
      };
    }
  }
}

let analyticsInstance = null;

export function getAnalytics() {
  if (!analyticsInstance) {
    analyticsInstance = new AnalyticsService();
  }
  return analyticsInstance;
}

export function trackPageView() {
  getAnalytics().trackPageView();
}

export function trackProductView(productId, productName, storeId, storeName, source) {
  getAnalytics().trackProductView(productId, productName, storeId, storeName, source);
}

export function trackAddToCart(productId, productName, storeId, storeName, price, quantity, cartItems, subtotal) {
  getAnalytics().trackAddToCart(productId, productName, storeId, storeName, price, quantity, cartItems, subtotal);
}

export function trackStoreView(storeId, storeName) {
  getAnalytics().trackStoreView(storeId, storeName);
}

export function trackFlyerView(flyerId, storeId, storeName) {
  getAnalytics().trackFlyerView(flyerId, storeId, storeName);
}

export function trackSpecialView(specialId, specialName, storeId, storeName) {
  getAnalytics().trackSpecialView(specialId, specialName, storeId, storeName);
}

export function trackCheckoutStarted() {
  getAnalytics().trackCheckoutStarted();
}

export function trackCartConverted() {
  getAnalytics().trackCartConverted();
}

export function setAnalyticsUser(userId, phone, name) {
  getAnalytics().setUserId(userId, phone, name);
}

export function trackCartAbandoned(cartItems, subtotal, storeId, storeName) {
  getAnalytics().trackCartAbandoned(cartItems, subtotal, storeId, storeName);
}