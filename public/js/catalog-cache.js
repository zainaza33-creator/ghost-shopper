// ============================================================
//  catalog-cache.js — Shared caching for stores & products
//  Saves Firestore reads by storing the catalog in localStorage.
// ============================================================

import { db, doc, getDoc, getDocs, collection } from './firebase-config.js';

const CACHE_KEY = 'gs_catalog_cache_v1';
const VERSION_KEY = 'gs_catalog_version';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Helper to get the current version from Firestore
async function getCatalogVersion() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'catalog'));
    if (snap.exists()) {
      // Force to string so it matches what we save in localStorage
      return String(snap.data().version || '1');
    }
  } catch (err) {
    console.warn('Could not fetch catalog version:', err);
  }
  return '1';
}

// Main function to get the catalog (stores + products)
export async function getCatalog(forceRefresh = false) {
  const cachedRaw = localStorage.getItem(CACHE_KEY);
  const cachedVersion = localStorage.getItem(VERSION_KEY);
  
  // If we have a cache and we aren't forcing a refresh, check the version
  if (cachedRaw && !forceRefresh) {
    try {
      const cache = JSON.parse(cachedRaw);
      const currentVersion = await getCatalogVersion();
      
      // Force both to strings to ensure they match
      if (String(cache.version) === currentVersion && (Date.now() - cache.timestamp < CACHE_TTL)) {
        console.log('📦 Using cached catalog');
        return { stores: cache.stores, products: cache.products, fromCache: true };
      }
    } catch (e) {
      console.warn('Cache parse error, fetching fresh...');
    }
  }

  // If we get here, we need to fetch from Firestore
  console.log('☁️ Fetching fresh catalog from Firestore...');
  const [storesSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, 'stores')),
    getDocs(collection(db, 'products'))
  ]);

  const stores = [];
  storesSnap.forEach(d => stores.push({ id: d.id, ...d.data() }));

  const products = [];
  productsSnap.forEach(d => products.push({ id: d.id, ...d.data() }));

  const currentVersion = await getCatalogVersion();

  // Save to localStorage
  const cacheData = {
    version: currentVersion,
    timestamp: Date.now(),
    stores,
    products
  };

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    localStorage.setItem(VERSION_KEY, currentVersion.toString());
  } catch (e) {
    console.warn('Could not save catalog to localStorage (storage full?)');
  }

  return { stores, products, fromCache: false };
}

// Helper to clear the cache (e.g., after admin changes)
export function clearCatalogCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(VERSION_KEY);
  console.log('🗑️ Catalog cache cleared');
}

// ============================================================
//  SPECIALS CACHE
// ============================================================
const SPECIALS_CACHE_KEY = 'gs_specials_cache_v1';
const SPECIALS_VERSION_KEY = 'gs_specials_version';

export async function getSpecialsCache(forceRefresh = false) {
  const cachedRaw = localStorage.getItem(SPECIALS_CACHE_KEY);
  const cachedVersion = localStorage.getItem(SPECIALS_VERSION_KEY);
  
  if (cachedRaw && !forceRefresh) {
    try {
      const cache = JSON.parse(cachedRaw);
      const currentVersion = await getCatalogVersion(); // Using the same version doc for now
      
      // Force both to strings
      if (String(cache.version) === currentVersion && (Date.now() - cache.timestamp < CACHE_TTL)) {
        console.log('📦 Using cached specials');
        return { specials: cache.specials, fromCache: true };
      }
    } catch (e) {
      console.warn('Specials cache parse error, fetching fresh...');
    }
  }

  console.log('☁️ Fetching fresh specials from Firestore...');
  const { db, collection, query, where, orderBy, limit, getDocs } = await import('./firebase-config.js');
  
  let snap;
  try {
    const q1 = query(collection(db, 'specials'), where('active', '!=', false), orderBy('active'), orderBy('createdAt', 'desc'), limit(100));
    snap = await getDocs(q1);
  } catch (_) {
    const q2 = query(collection(db, 'specials'), orderBy('createdAt', 'desc'), limit(100));
    snap = await getDocs(q2);
  }

  const rawSpecials = [];
  const now = new Date();
  
  snap.forEach(d => {
    const data = d.data();
    if (data.active === false) return;

    if (data.endDate) {
      // Handle both Firestore Timestamps and plain string dates
      let end;
      if (typeof data.endDate === 'string') {
        end = new Date(data.endDate + 'T23:59:59');
      } else {
        end = data.endDate.toDate ? data.endDate.toDate() : new Date(data.endDate);
      }
      
      if (!isNaN(end)) {
        // Force end time to 23:59:59 on that day
        end.setHours(23, 59, 59, 999);
        if (end < now) return;
      }
    }
    rawSpecials.push({ id: d.id, ...data });
  });

  // BAKE IN THE ALTERNATIVES
  const specials = rawSpecials.map(special => {
    const others = rawSpecials.filter(s => 
      s.storeId === special.storeId && 
      s.id !== special.id
    );
    
    const sameCat = others.filter(s => 
      s.category && special.category && 
      s.category.toLowerCase() === special.category.toLowerCase()
    );
    const rest = others.filter(s => !sameCat.includes(s));
    
    return {
      ...special,
      otherSpecials: [...sameCat, ...rest]
    };
  });

  const currentVersion = await getCatalogVersion();

  try {
    localStorage.setItem(SPECIALS_CACHE_KEY, JSON.stringify({
      version: currentVersion,
      timestamp: Date.now(),
      specials
    }));
    localStorage.setItem(SPECIALS_VERSION_KEY, currentVersion.toString());
  } catch (e) {}

  return { specials, fromCache: false };
}