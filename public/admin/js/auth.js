// ============================================================
//  AUTH.JS - Authentication & admin checks
// ============================================================

import { auth, db, doc, getDoc } from '../../js/firebase-config.js';
import { showToast } from './utils.js';

let currentUser = null;
let userData = null;

export async function initAuth() {
  return new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      
      if (!user) {
        // Redirect to root login page, not /admin/login.html
        const loginUrl = window.location.origin + '/login.html';
        window.location.replace(loginUrl);
        reject(new Error('Not authenticated'));
        return;
      }
      
      currentUser = user;
      
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
          showToast('User not found. Redirecting...');
          setTimeout(() => {
            window.location.replace('/');
          }, 1500);
          reject(new Error('User not found'));
          return;
        }
        
        userData = docSnap.data();
        const role = userData.role || 'customer';
        
        if (role !== 'admin') {
          showToast('Access denied. Admin only.');
          setTimeout(() => {
            if (role === 'driver') {
              window.location.replace('/driver-dashboard.html');
            } else {
              window.location.replace('/');
            }
          }, 1500);
          reject(new Error('Access denied'));
          return;
        }
        
        resolve(user);
        
      } catch (error) {
        console.error('Auth error:', error);
        reject(error);
      }
    });
  });
}

export function getCurrentUser() {
  return currentUser;
}

export function getUserData() {
  return userData;
}

export function isAdmin() {
  return userData && userData.role === 'admin';
}