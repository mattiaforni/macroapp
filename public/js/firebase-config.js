// Configurazione web di Firebase.
// Copiare i valori da: Console Firebase → Impostazioni progetto → Le tue app → Web.
// Questi valori non sono segreti (sono protetti dalle regole di sicurezza e dai domini autorizzati),
// quindi possono stare nel repository.
export const firebaseConfig = {
  apiKey: "AIzaSyDzJNWRsULzAjecdR3iq7AqQGodSH3wc1E",
  authDomain: "macroapp-b9bd0.firebaseapp.com",
  projectId: "macroapp-b9bd0",
  storageBucket: "macroapp-b9bd0.firebasestorage.app",
  messagingSenderId: "991261903778",
  appId: "1:991261903778:web:debc3ee3b849872faa00fb",
};

// Regione delle Cloud Functions (deve coincidere con functions/index.js).
export const functionsRegion = "europe-west1";
