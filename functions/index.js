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
      // Non basta «nessuna app»: firebase-functions crea per sé un'app con un altro nome
      // (per verificare l'accesso nelle onCall), e quella non è l'app predefinita.
      const app = getApps().find((a) => a.name === "[DEFAULT]") || initializeApp();
      return getFirestore(app);
    })().catch((err) => { dbPromise = null; throw err; }); // al prossimo giro si riprova
  }
  return dbPromise;
}

/**
 * Agente: legge una nota del diario (solo del chiamante) e scrive proposte nella coda.
 * Ritorna { proposals: n }.
 */
/** Errore del provider AI → [codice, messaggio leggibile]. */
function spiegaErrore(msg = "") {
  if (/credit balance/i.test(msg)) return ["resource-exhausted", "Credito dell'API Anthropic esaurito: ricaricalo da Billing nella console"];
  if (/anthropic-workspace-id|not scoped to a workspace/i.test(msg)) return ["failed-precondition", "La chiave non è legata a un workspace: creane una scegliendo il workspace"];
  if (/usage limits/i.test(msg)) return ["resource-exhausted", "Limite di spesa dell'API raggiunto"];
  if (/\b(429|529)\b|overloaded|rate_limit/i.test(msg)) return ["unavailable", "AI occupata in questo momento: riprova tra poco"];
  return ["internal", `Analisi non riuscita (${msg.slice(0, 160)})`];
}

export const analyzeEntry = onCall(
  { secrets: [ANTHROPIC_API_KEY, GEMINI_API_KEY], timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const { entryId } = req.data || {};
    if (!entryId) throw new HttpsError("invalid-argument", "entryId mancante");

    // Tempi delle fasi nel registro (si leggono col flusso «Diagnosi»).
    const t0 = Date.now();
    const passo = (s) => console.log(`analyzeEntry ${entryId}: ${s} dopo ${Date.now() - t0} ms`);
    try {
      passo("inizio");
      const db = await getDb();
      const snap = await db.collection("journal_entries").doc(entryId).get();
      if (!snap.exists || snap.data().ownerUid !== req.auth.uid) {
        throw new HttpsError("permission-denied", "Nota non trovata");
      }
      const entry = { id: snap.id, ...snap.data() };
      passo("nota letta");
      const { analyzeJournalEntry } = await import("./src/agent.js");
      const n = await analyzeJournalEntry(db, entry, {
        uid: req.auth.uid,
        passo,
        keys: { anthropic: ANTHROPIC_API_KEY.value().trim(), gemini: GEMINI_API_KEY.value().trim() },
      });
      return { proposals: n };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("analyzeEntry", err);
      // 401: chiave assente o fittizia. Il telefono mostra «AI non ancora collegata».
      if (/\b401\b|authentication|invalid x-api-key/i.test(err.message)) {
        throw new HttpsError("failed-precondition", "Chiave dell'AI non configurata");
      }
      // Gli altri errori arrivano al telefono in chiaro: i log delle funzioni non li legge nessuno.
      const [codice, testo] = spiegaErrore(err.message);
      throw new HttpsError(codice, testo);
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
