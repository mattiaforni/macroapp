// Autenticazione Google e profilo utente.
import {
  signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { auth, db, googleProvider } from "./firebase.js";

export const session = {
  user: null,       // utente Firebase
  profile: null,    // documento users/{uid}
  householdId: null,
};

const listeners = new Set();
export function onSession(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(session); }

export async function login() {
  // Su mobile installato (standalone) il popup può essere bloccato: si usa il redirect.
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (standalone) return signInWithRedirect(auth, googleProvider);
  return signInWithPopup(auth, googleProvider);
}

export function logout() { return signOut(auth); }

async function loadProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const profile = {
      displayName: user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      householdId: null,
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  }
  return snap.data();
}

export function startAuth() {
  onAuthStateChanged(auth, async (user) => {
    session.user = user;
    if (user) {
      try {
        session.profile = await loadProfile(user);
        session.householdId = session.profile.householdId || null;
      } catch (err) {
        console.error("Caricamento profilo fallito", err);
        session.error = `Impossibile leggere il profilo: ${err.code || err.message}`;
        session.profile = null;
        session.householdId = null;
      }
    } else {
      session.profile = null;
      session.householdId = null;
    }
    emit();
  });
}

export async function refreshProfile() {
  if (!session.user) return;
  session.profile = await loadProfile(session.user);
  session.householdId = session.profile.householdId || null;
  emit();
}
