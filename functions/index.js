// Cloud Functions (2ª generazione), regione europe-west1.
// Segreti (Secret Manager): firebase functions:secrets:set ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY
//
// All'avvio del container si caricano solo le dichiarazioni delle funzioni.
// firebase-admin, l'agente e il client bancario vengono importati alla prima richiesta (import dinamico):
// avvio più rapido e nessun lavoro a livello di modulo che possa bloccare il container.
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";

setGlobalOptions({ region: "europe-west1", maxInstances: 5, memory: "512MiB" });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const ENABLE_BANKING_APP_ID = defineSecret("ENABLE_BANKING_APP_ID");
const ENABLE_BANKING_PRIVATE_KEY = defineSecret("ENABLE_BANKING_PRIVATE_KEY");

let dbPromise = null;
/** Firestore (Admin SDK), inizializzato alla prima chiamata. */
function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { initializeApp, getApps } = await import("firebase-admin/app");
      const { getFirestore } = await import("firebase-admin/firestore");
      if (!getApps().length) initializeApp();
      return getFirestore();
    })();
  }
  return dbPromise;
}

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

    const db = await getDb();
    const snap = await db.collection("journal_entries").doc(entryId).get();
    if (!snap.exists || snap.data().ownerUid !== req.auth.uid) {
      throw new HttpsError("permission-denied", "Nota non trovata");
    }
    const entry = { id: snap.id, ...snap.data() };
    const { analyzeJournalEntry } = await import("./src/agent.js");
    try {
      const n = await analyzeJournalEntry(db, entry, {
        uid: req.auth.uid,
        keys: { anthropic: ANTHROPIC_API_KEY.value().trim(), gemini: GEMINI_API_KEY.value().trim() },
      });
      return { proposals: n };
    } catch (err) {
      console.error("analyzeEntry", err.message);
      // 401: chiave assente o fittizia. Il telefono mostra «AI non ancora collegata».
      if (/\b401\b|authentication|invalid x-api-key/i.test(err.message)) {
        throw new HttpsError("failed-precondition", "Chiave dell'AI non configurata");
      }
      throw new HttpsError("internal", "Analisi non riuscita");
    }
  },
);

/**
 * Sincronizzazione bancaria giornaliera: per ogni collegamento attivo scarica i movimenti
 * e crea proposte di spesa. Resta inattiva finché non esistono documenti in bank_connections.
 */
export const syncBank = onSchedule(
  { schedule: "every day 07:15", timeZone: "Europe/Rome", secrets: [ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY], timeoutSeconds: 300 },
  async () => {
    const db = await getDb();
    const { syncAllConnections } = await import("./src/banking/enable.js");
    await syncAllConnections(db, {
      appId: ENABLE_BANKING_APP_ID.value(),
      privateKey: ENABLE_BANKING_PRIVATE_KEY.value(),
    });
  },
);
