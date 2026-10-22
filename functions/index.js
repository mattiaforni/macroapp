// Cloud Functions (2ª generazione), regione europe-west1.
// Segreti (Secret Manager): firebase functions:secrets:set ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { analyzeJournalEntry } from "./src/agent.js";
import { syncAllConnections } from "./src/banking/enable.js";

initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 5 });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const ENABLE_BANKING_APP_ID = defineSecret("ENABLE_BANKING_APP_ID");
const ENABLE_BANKING_PRIVATE_KEY = defineSecret("ENABLE_BANKING_PRIVATE_KEY");

/**
 * Agente: legge una nota del diario (solo del chiamante) e scrive proposte nella coda.
 * Ritorna { proposals: n }.
 */
export const analyzeEntry = onCall(
  { secrets: [ANTHROPIC_API_KEY, GEMINI_API_KEY], timeoutSeconds: 60 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const { entryId } = req.data || {};
    if (!entryId) throw new HttpsError("invalid-argument", "entryId mancante");

    const db = getFirestore();
    const snap = await db.collection("journal_entries").doc(entryId).get();
    if (!snap.exists || snap.data().ownerUid !== req.auth.uid) {
      throw new HttpsError("permission-denied", "Nota non trovata");
    }
    const entry = { id: snap.id, ...snap.data() };
    const n = await analyzeJournalEntry(db, entry, {
      uid: req.auth.uid,
      keys: { anthropic: ANTHROPIC_API_KEY.value(), gemini: GEMINI_API_KEY.value() },
    });
    return { proposals: n };
  },
);

/**
 * Sincronizzazione bancaria giornaliera: per ogni collegamento attivo scarica i movimenti
 * e crea proposte di spesa. Resta inattiva finché non esistono documenti in bank_connections.
 */
export const syncBank = onSchedule(
  { schedule: "every day 07:15", timeZone: "Europe/Rome", secrets: [ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY], timeoutSeconds: 300 },
  async () => {
    await syncAllConnections(getFirestore(), {
      appId: ENABLE_BANKING_APP_ID.value(),
      privateKey: ENABLE_BANKING_PRIVATE_KEY.value(),
    });
  },
);
