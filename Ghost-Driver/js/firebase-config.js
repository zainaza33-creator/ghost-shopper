// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { 
  getAuth, 
  signInWithPhoneNumber, 
  RecaptchaVerifier,
  onAuthStateChanged,   // ← ADD THIS
  signOut               // ← ADD THIS
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { 
  getFirestore,
  doc, getDoc, setDoc, collection, getDocs, onSnapshot,
  query, where, serverTimestamp, orderBy, limit,
  writeBatch, runTransaction, arrayUnion, arrayRemove,
  updateDoc, deleteDoc, addDoc, getCountFromServer, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";

// Fallback config (same as before)
const FALLBACK_CONFIG = {
  apiKey: "AIzaSyBnYQqVzQTdbhjd2bXKKqvKkSIc4XGpwSw",
  authDomain: "ghostshopza.firebaseapp.com",
  projectId: "ghostshopza",
  storageBucket: "ghostshopza.firebasestorage.app",
  messagingSenderId: "473222699760",
  appId: "1:473222699760:web:3c0f791cd90cd823868035"
};

const firebaseConfig = window.__ENV?.FIREBASE || FALLBACK_CONFIG;

if (!window.__ENV) {
  console.warn('⚠️ env.js not loaded, using fallback config');
  window.__ENV = { FIREBASE: firebaseConfig };
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

export { 
  app, auth, db, storage, functions,
  signInWithPhoneNumber, RecaptchaVerifier,
  onAuthStateChanged,   // ← ADD THIS
  signOut,              // ← ADD THIS
  doc, getDoc, setDoc, collection, getDocs, onSnapshot, query, where,
  serverTimestamp, orderBy, limit, writeBatch, runTransaction,
  arrayUnion, arrayRemove, updateDoc, deleteDoc, addDoc,
  getCountFromServer, Timestamp,
  getFunctions, httpsCallable
};