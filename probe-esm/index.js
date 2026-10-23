// Test di isolamento 2 e 3: moduli ES come il codice principale.
//   pingesm    → ESM puro, nessun segreto
//   pingsecret → ESM + un segreto montato (GEMINI_API_KEY), letto solo dentro la richiesta
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

export const pingesm = onRequest({ region: "europe-west1" }, (req, res) => {
  res.send("ok esm");
});

export const pingsecret = onRequest({ region: "europe-west1", secrets: [GEMINI_API_KEY] }, (req, res) => {
  res.send(`ok secret (lunghezza ${GEMINI_API_KEY.value().length})`);
});
