// js/firebase-config.js — Ghost Stores Firebase init
// Shares the same Firebase project as the customer site.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where, getDocs,
  serverTimestamp, onSnapshot, orderBy
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const FALLBACK = {
  apiKey: "AIzaSyBnYQqVzQTdbhjd2bXKKqvKkSIc4XGpwSw",
  authDomain: "ghostshopza.firebaseapp.com",
  projectId: "ghostshopza",
  storageBucket: "ghostshopza.firebasestorage.app",
  messagingSenderId: "473222699760",
  appId: "1:473222699760:web:3c0f791cd90cd823868035"
};

const firebaseConfig = window.__ENV?.FIREBASE || FALLBACK;

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export {
  app, auth, db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence,
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where, getDocs,
  serverTimestamp, onSnapshot, orderBy
};