import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// Firebase config from environment variables (with safe fallback during setup)
export const isFirebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID
);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSy-duo-placeholder-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'duo-couples.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'duo-couples',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'duo-couples.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1234567890:web:abcdef123456',
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const functions = getFunctions(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ─── Auth Functions ─────────────────────────────────────────────

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await ensureProfileExists(result.user);
    return result.user;
  } catch (err: any) {
    if (
      err?.code === 'auth/popup-blocked' ||
      err?.code === 'auth/cancelled-popup-request'
    ) {
      console.warn('[Auth] Popup blocked or failed, attempting redirect login...', err);
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function checkRedirectAuth(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      await ensureProfileExists(result.user);
      return result.user;
    }
  } catch (err) {
    console.error('Redirect sign-in error:', err);
  }
  return null;
}

export async function signUpWithEmail(email: string, password: string, displayName: string) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  await ensureProfileExists(result.user, displayName);
  return result.user;
}

export async function signInWithEmail(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await ensureProfileExists(result.user);
  return result.user;
}

export async function signOut() {
  return firebaseSignOut(auth);
}

// ─── Profile Management ─────────────────────────────────────────

export interface DuoProfile {
  uid: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  timezone: string;
  theme: 'midnight' | 'sunset' | 'neon' | 'emerald' | 'pastel';
  quietHoursStart: string;
  quietHoursEnd: string;
  moodStatus: string;
  coupleId: string | null;
  createdAt: any;
}

/**
 * Ensures a profile document exists in Firestore for the authenticated user.
 * Called after every sign-in (idempotent — won't overwrite existing profiles).
 */
async function ensureProfileExists(user: User, overrideName?: string) {
  const profileRef = doc(db, 'profiles', user.uid);
  const snap = await getDoc(profileRef);

  if (!snap.exists()) {
    const profile: DuoProfile = {
      uid: user.uid,
      displayName: overrideName || user.displayName || 'Aryan',
      email: user.email || '',
      avatarUrl: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: 'midnight',
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
      moodStatus: 'Welcome to AV ✨',
      coupleId: null,
      createdAt: serverTimestamp(),
    };
    await setDoc(profileRef, profile);
  }
}

/**
 * Get the current user's profile from Firestore.
 */
export async function getProfile(uid: string): Promise<DuoProfile | null> {
  const snap = await getDoc(doc(db, 'profiles', uid));
  return snap.exists() ? (snap.data() as DuoProfile) : null;
}

// ─── Auth State Observer ─────────────────────────────────────────

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}
