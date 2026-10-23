// Configurazione web di Firebase.
// Copiare i valori da: Console Firebase → Impostazioni progetto → Le tue app → Web.
// Questi valori non sono segreti (sono protetti dalle regole di sicurezza e dai domini autorizzati),
// quindi possono stare nel repository.
// authDomain = dominio da cui è servita l'app (se è un dominio Firebase Hosting).
// Così il login con redirect resta sullo stesso dominio e funziona anche sui browser mobili
// che bloccano lo storage di terze parti (Chrome, Safari, Firefox recenti).
// Richiede che https://<dominio>/__/auth/handler sia tra gli URI di reindirizzamento autorizzati
// del client OAuth (Google Cloud → API e servizi → Credenziali).
const host = typeof location !== "undefined" ? location.hostname : "";
const onFirebaseHosting = host.endsWith(".web.app") || host.endsWith(".firebaseapp.com");

export const firebaseConfig = {
  apiKey: "AIzaSyDzJNWRsULzAjecdR3iq7AqQGodSH3wc1E",
  authDomain: onFirebaseHosting ? host : "macroapp-b9bd0.firebaseapp.com",
  projectId: "macroapp-b9bd0",
  storageBucket: "macroapp-b9bd0.firebasestorage.app",
  messagingSenderId: "991261903778",
  appId: "1:991261903778:web:debc3ee3b849872faa00fb",
};

// Regione delle Cloud Functions (deve coincidere con functions/index.js).
export const functionsRegion = "europe-west1";
