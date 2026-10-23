// Test 4: come pingesm, ma con firebase-admin caricato e inizializzato all'avvio (come il codice principale).
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();

export const pingadmin = onRequest({ region: "europe-west1" }, (req, res) => {
  res.send(`ok admin (${typeof getFirestore})`);
});
