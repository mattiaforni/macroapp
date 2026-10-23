// Autenticazione Google e profilo utente.
import {
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
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
  // Su telefono (browser o app installata) si usa il redirect; su computer il popup,
  // con ripiego sul redirect se il browser blocca la finestra.
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (standalone || touch) return signInWithRedirect(auth, googleProvider);
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, googleProvider);
    }
    throw err;
  }
}

/**
 * Esito di un accesso con redirect: se fallisce, lo rende visibile invece di tornare in silenzio
 * al login. Si calcola una volta sola: chi lo chiede di nuovo riceve lo stesso esito.
 */
let esito = null;
export function checkRedirectResult() {
  esito ??= getRedirectResult(auth).then(
    () => null,
    (err) => { console.error("Redirect di Google fallito", err); return err.code || err.message; },
  );
  return esito;
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
