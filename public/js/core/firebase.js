// Inizializzazione Firebase (SDK modulare via CDN, nessun bundler).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { firebaseConfig, functionsRegion } from "../firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, functionsRegion);

export const googleProvider = new GoogleAuthProvider();
// L'accesso chiede solo nome ed email. Il permesso per Google Contatti si chiede a parte,
// quando serve (core/contatti-google.js).

// Cache offline: la lista della spesa deve funzionare anche al supermercato senza rete.
enableIndexedDbPersistence(db).catch((err) => {
  // failed-precondition: più schede aperte; unimplemented: browser senza supporto.
  console.warn("Persistenza offline non attiva:", err.code);
});
