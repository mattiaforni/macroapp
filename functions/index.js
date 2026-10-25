// Cloud Functions (2ª generazione), regione europe-west1.
// Segreti (Secret Manager): firebase functions:secrets:set ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY
// GOOGLE_OAUTH_CLIENT ({"id","secret"} del client web dell'accesso con Google) lo scrive il deploy.
//
// Funzioni: analyzeEntry (agente del diario), bank (collegamento e lettura della banca), syncBank (lettura quotidiana).
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
const GOOGLE_OAUTH_CLIENT = defineSecret("GOOGLE_OAUTH_CLIENT");

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
      const { azioni, riepilogo } = await analyzeJournalEntry(db, entry, {
        uid: req.auth.uid,
        passo,
        keys: { anthropic: ANTHROPIC_API_KEY.value().trim(), gemini: GEMINI_API_KEY.value().trim() },
      });
      return { proposals: azioni, riepilogo };
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

// ───────────── Banca ─────────────

// Dove la banca rimanda l'utente dopo il consenso: deve essere tra gli «Allowed Redirect URLs»
// dell'app in Enable Banking. L'app lo propone (la sua origine); si accetta solo se è uno di questi.
const RITORNI_BANCA = ["https://macroapp-b9bd0.web.app/banca", "https://macroapp-b9bd0.firebaseapp.com/banca"];

/** Errore di Enable Banking → [codice, messaggio leggibile]. */
function spiegaErroreBanca(err, eb) {
  const s = err.status;
  if (eb.sessioneChiusa(err)) return ["failed-precondition", "La banca ha chiuso il consenso: rinnovalo per riprendere la lettura"];
  if (s === 0) return ["failed-precondition", "Banca non ancora configurata: mancano le chiavi di Enable Banking"];
  if (s === 401) return ["failed-precondition", `Enable Banking non accetta le credenziali dell'app (${err.code || err.body.slice(0, 120)})`];
  if (s === 403) return ["permission-denied", "Enable Banking non permette questa operazione (app in modalità ristretta?)"];
  if (s === 422 || s === 400) return ["invalid-argument", `Richiesta rifiutata da Enable Banking (${err.body.slice(0, 160)})`];
  if (s === 429) return ["resource-exhausted", "Troppe richieste alla banca: riprova tra poco"];
  return ["internal", `Banca non raggiungibile (${(err.message || "").slice(0, 160)})`];
}

/**
 * Collegamento e lettura della banca, un'azione per chiamata ({ azione }):
 *   banche      → { banche: [{ name, country, beta, maxConsentSeconds }] }      (country, predefinito IT)
 *   avvia       → { url }         apre il consenso; aspsp: { name, country }, ritorno: origine dell'app
 *   concludi    → { accounts }    code e state tornati dalla banca; salva bank_connections/{uid}
 *   scollega    → { ok }          chiude la sessione e disattiva il collegamento
 *   sincronizza → { created }     legge subito i movimenti (la stessa cosa che syncBank fa ogni mattina)
 * Scrive solo in bank_connections/{uid} del chiamante e, sincronizzando, in proposals.
 */
export const bank = onCall(
  { secrets: [ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY], timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const uid = req.auth.uid;
    const { azione } = req.data || {};
    const db = await getDb();
    const eb = await import("./src/banking/enable.js");
    const credenziali = { appId: ENABLE_BANKING_APP_ID.value().trim(), privateKey: ENABLE_BANKING_PRIVATE_KEY.value().trim() };
    const ref = db.collection("bank_connections").doc(uid);
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
    const scadenza = (iso) => (iso ? Timestamp.fromDate(new Date(iso)) : null);

    try {
      if (azione === "banche") {
        const country = /^[A-Z]{2}$/.test(req.data?.country || "") ? req.data.country : "IT";
        return { banche: await eb.elencoBanche(eb.makeJwt(credenziali), country) };
      }

      if (azione === "avvia") {
        const { aspsp, ritorno } = req.data || {};
        if (!aspsp?.name || !aspsp?.country) throw new HttpsError("invalid-argument", "Banca non indicata");
        const profilo = (await db.collection("users").doc(uid).get()).data() || {};
        if (!profilo.householdId) throw new HttpsError("failed-precondition", "Prima crea o raggiungi una casa");
        const jwt = eb.makeJwt(credenziali);
        // La banca va presa dall'elenco: si controlla che esista e quanto consenso concede al massimo.
        const banca = (await eb.elencoBanche(jwt, aspsp.country)).find((b) => b.name === aspsp.name);
        if (!banca) throw new HttpsError("invalid-argument", "Banca non trovata nell'elenco di Enable Banking");
        const redirectUrl = RITORNI_BANCA.find((u) => ritorno && u.startsWith(ritorno)) || RITORNI_BANCA[0];
        const state = eb.nuovoState();
        const { url, authorizationId } = await eb.avviaAutorizzazione(jwt, {
          aspsp: { name: banca.name, country: banca.country }, state, redirectUrl, validUntil: eb.scadenzaConsenso(banca.maxConsentSeconds),
        });
        await ref.set({
          ownerUid: uid, householdId: profilo.householdId,
          pending: { state, authorizationId, aspsp: { name: banca.name, country: banca.country }, startedAt: FieldValue.serverTimestamp() },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { url };
      }

      if (azione === "concludi") {
        const { code, state } = req.data || {};
        if (!code) throw new HttpsError("invalid-argument", "Codice della banca mancante");
        const attuale = (await ref.get()).data() || {};
        if (!attuale.pending || attuale.pending.state !== state) {
          throw new HttpsError("failed-precondition", "Collegamento non avviato da questa app: ricomincia dalla scelta della banca");
        }
        const jwt = eb.makeJwt(credenziali);
        const sessione = await eb.creaSessione(jwt, code);
        if (!sessione.accounts.length) {
          throw new HttpsError("not-found", "La banca non ha restituito conti. In modalità ristretta i conti vanno prima collegati nel Control Panel di Enable Banking («Link accounts»)");
        }
        // Un consenso nuovo sostituisce il precedente: la vecchia sessione si chiude, se c'è ancora.
        if (attuale.sessionId && attuale.sessionId !== sessione.sessionId) {
          await eb.chiudiSessione(jwt, attuale.sessionId).catch((e) => console.warn("chiusura sessione precedente", e.message));
        }
        await ref.set({
          ownerUid: uid, householdId: attuale.householdId,
          active: true,
          aspsp: sessione.aspsp || attuale.pending.aspsp,
          sessionId: sessione.sessionId,
          accounts: sessione.accounts,
          accountIds: sessione.accounts.map((a) => a.uid),
          consentExpiresAt: scadenza(sessione.validUntil),
          linkedAt: FieldValue.serverTimestamp(),
          pending: FieldValue.delete(),
          lastError: null,
          needsRenewal: false, sessionStatus: "AUTHORIZED", sessionEndedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { accounts: sessione.accounts, consentExpiresAt: sessione.validUntil };
      }

      if (azione === "scollega") {
        const attuale = (await ref.get()).data();
        if (!attuale) return { ok: true };
        if (attuale.sessionId) {
          await eb.chiudiSessione(eb.makeJwt(credenziali), attuale.sessionId).catch((e) => console.warn("chiusura sessione", e.message));
        }
        await ref.set({
          active: false, sessionId: null, accounts: [], accountIds: [], consentExpiresAt: null,
          needsRenewal: false, sessionStatus: null, sessionEndedAt: FieldValue.delete(),
          pending: FieldValue.delete(), unlinkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { ok: true };
      }

      if (azione === "sincronizza") {
        const snap = await ref.get();
        if (!snap.exists || !snap.data().active) throw new HttpsError("failed-precondition", "Nessuna banca collegata");
        const created = await eb.syncConnection(db, ref, snap.data(), credenziali);
        return { created };
      }

      throw new HttpsError("invalid-argument", `Azione sconosciuta: ${azione}`);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("bank", azione, err);
      const [codice, testo] = err instanceof eb.EnableBankingError ? spiegaErroreBanca(err, eb) : ["internal", `Operazione non riuscita (${(err.message || "").slice(0, 160)})`];
      throw new HttpsError(codice, testo);
    }
  },
);

/**
 * Google Contatti: collegamento una tantum e permessi di un'ora per leggere i contatti.
 * Il refresh token resta in google_tokens/{uid}, che l'app non legge. Vedi src/google/contatti.js.
 */
export const contatti = onCall(
  { secrets: [GOOGLE_OAUTH_CLIENT], timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    let client = null;
    try { client = JSON.parse(GOOGLE_OAUTH_CLIENT.value() || "{}"); } catch (e) { client = null; }
    try {
      const db = await getDb();
      const { gestisci } = await import("./src/google/contatti.js");
      return await gestisci(db, { uid: req.auth.uid, email: req.auth.token?.email || "" }, req.data || {}, client);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("contatti", err);
      throw new HttpsError("internal", `Contatti non raggiungibili (${String(err.message).slice(0, 160)})`);
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
