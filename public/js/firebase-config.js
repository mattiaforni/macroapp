// Configurazione web di Firebase.
// Copiare i valori da: Console Firebase → Impostazioni progetto → Le tue app → Web.
// Questi valori non sono segreti (sono protetti dalle regole di sicurezza e dai domini autorizzati),
// quindi possono stare nel repository.
export const firebaseConfig = {
  apiKey: "INSERIRE",
  authDomain: "INSERIRE.firebaseapp.com",
  projectId: "INSERIRE",
  storageBucket: "INSERIRE.appspot.com",
  messagingSenderId: "INSERIRE",
  appId: "INSERIRE",
};

// Regione delle Cloud Functions (deve coincidere con functions/index.js).
export const functionsRegion = "europe-west1";
