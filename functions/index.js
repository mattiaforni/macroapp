// Cloud Functions (2ª generazione), regione europe-west1.
// Segreti (Secret Manager): firebase functions:secrets:set ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY
// GOOGLE_OAUTH_CLIENT ({"id","secret"} del client web dell'accesso con Google) lo scrive il deploy.
//
// Funzioni: analyzeEntry (agente del diario), bank (collegamento e lettura della banca), google (account Google:
// Contatti, Calendario, Drive),
// avvisa (notifiche push sulle cose condivise), trascrivi (nota vocale → testo, con Gemini), prodotto (scheda di un
// prodotto da Open Food Facts), syncBank (lettura quotidiana).
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
 * Ritorna { proposals: n, riepilogo, sintesi }.
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
  // 300 s: Opus su una nota di progetto lunga può superare i due minuti (vedi src/ai/claude.js).
  { secrets: [ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_OAUTH_CLIENT], timeoutSeconds: 300 },
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
      const { azioni, riepilogo, sintesi, modello } = await analyzeJournalEntry(db, entry, {
        uid: req.auth.uid,
        passo,
        keys: { anthropic: ANTHROPIC_API_KEY.value().trim(), gemini: GEMINI_API_KEY.value().trim() },
        clientGoogle: clientGoogle(), // per leggere i documenti di Drive del progetto
      });
      return { proposals: azioni, riepilogo, sintesi, modello };
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
  if (s === 429 && err.code === "ASPSP_RATE_LIMIT_EXCEEDED") return ["resource-exhausted", "La banca ha raggiunto il limite di letture di oggi: riprova più tardi"];
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
        // L'ha chiesto l'utente dall'app: la banca lo sa dalle intestazioni PSU e non lo conta nel limite giornaliero.
        const created = await eb.syncConnection(db, ref, snap.data(), credenziali, { psu: eb.intestazioniPsu(req.rawRequest) });
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

/** ID e secret del client OAuth web, dal segreto che il deploy scrive; null se mancano. */
function clientGoogle() {
  try { return JSON.parse(GOOGLE_OAUTH_CLIENT.value() || "{}"); } catch (e) { return null; }
}

/**
 * Account Google: collegamento una tantum (Contatti, Calendario, Drive) e permessi di un'ora con cui
 * l'app legge e scrive direttamente sulle API di Google. Il refresh token resta in google_tokens/{uid},
 * che l'app non legge. Vedi src/google/account.js.
 */
export const google = onCall(
  { secrets: [GOOGLE_OAUTH_CLIENT], timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    try {
      const db = await getDb();
      const { gestisci } = await import("./src/google/account.js");
      return await gestisci(db, { uid: req.auth.uid, email: req.auth.token?.email || "" }, req.data || {}, clientGoogle());
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("google", err);
      throw new HttpsError("internal", `Google non raggiungibile (${String(err.message).slice(0, 160)})`);
    }
  },
);

/**
 * Notifiche push. L'app la chiama dopo una scrittura condivisa ({ coll, id, evento }) o per una
 * prova ({ prova: true }); il server rilegge il documento e avvisa gli altri membri della casa,
 * secondo le loro preferenze. Ritorna { inviati }. Vedi src/avvisi.js.
 */
export const avvisa = onCall(
  { timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    try {
      const db = await getDb();
      const { avvisaDaApp } = await import("./src/avvisi.js");
      return await avvisaDaApp(db, req.auth.uid, req.data || {});
    } catch (err) {
      console.error("avvisa", err.code || "", String(err.message).slice(0, 200));
      throw new HttpsError("internal", `Notifica non inviata (${String(err.message).slice(0, 160)})`);
    }
  },
);

// Quanto a lungo vale una scheda in cache: un prodotto trovato un mese (OFF cambia poco), uno
// non trovato un giorno (qualcuno potrebbe aggiungerlo, o il codice era letto male).
const CACHE_TROVATO_MS = 30 * 24 * 3600 * 1000;
const CACHE_ASSENTE_MS = 24 * 3600 * 1000;

/**
 * Scheda di un prodotto dal codice a barre ({ ean }), da Open Food Facts con l'indice calcolato
 * in src/prodotti/indice.js. La scheda sta in prodotti/{ean} (cache della casa: la legge chiunque sia
 * autenticato, la scrive solo il server); { aggiorna: true } la rilegge da OFF comunque.
 * Ritorna la scheda ({ trovato: false, ean } se il codice non c'è).
 */
// ───────────── Trascrizione delle note vocali ─────────────

// Formati che il telefono registra (MediaRecorder) e che Gemini accetta. Chrome: webm/opus; Safari: mp4 (= m4a).
const FORMATI_AUDIO = { "audio/webm": "audio/webm", "audio/ogg": "audio/ogg", "audio/mp4": "audio/m4a", "audio/m4a": "audio/m4a", "audio/aac": "audio/aac", "audio/mpeg": "audio/mpeg", "audio/wav": "audio/wav" };
const MAX_AUDIO_BASE64 = 12_000_000; // ~9 MB di audio: a 32 kbit/s più di mezz'ora

/**
 * Nota vocale → testo. data = { audio (base64), mimeType, projectId? }. Ritorna { testo }.
 * Con projectId il prompt riceve nome, istruzioni e temi del progetto; sempre i nomi della rubrica
 * (src/trascrizione.js). L'audio non viene salvato da nessuna parte.
 */
export const trascrivi = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const { audio, mimeType, projectId } = req.data || {};
    if (typeof audio !== "string" || audio.length < 100) throw new HttpsError("invalid-argument", "Registrazione vuota");
    if (audio.length > MAX_AUDIO_BASE64) throw new HttpsError("invalid-argument", "Registrazione troppo lunga: dividila in due note");
    const tipo = FORMATI_AUDIO[String(mimeType || "").split(";")[0].trim().toLowerCase()];
    if (!tipo) throw new HttpsError("invalid-argument", `Formato audio non previsto (${String(mimeType).slice(0, 40)})`);
    const t0 = Date.now();
    try {
      const db = await getDb();
      const { contestoTrascrizione } = await import("./src/trascrizione.js");
      const contesto = await contestoTrascrizione(db, req.auth.uid, projectId || null);
      const { transcribe } = await import("./src/ai/provider.js");
      const { testo, uso } = await transcribe({ audioBase64: audio, mimeType: tipo, keys: { gemini: GEMINI_API_KEY.value().trim() }, contesto });
      // Nel registro solo misure: niente testo (il repository è pubblico e la Diagnosi pubblica il registro).
      console.log(`trascrivi: ${Math.round((audio.length * 0.75) / 1024)} KB ${tipo}, ${testo.length} caratteri in ${Date.now() - t0} ms`
        + (uso ? `, token ${uso.promptTokenCount ?? "?"} in / ${uso.candidatesTokenCount ?? "?"} out / ${uso.thoughtsTokenCount ?? 0} pensiero` : "")
        + (contesto.progetto ? ", con progetto" : ""));
      return { testo };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = String(err.message || "");
      console.error("trascrivi", msg.slice(0, 300));
      if (/API_KEY_INVALID|API key not valid|\b403\b/i.test(msg)) throw new HttpsError("failed-precondition", "La chiave di Gemini non è valida o non ha accesso all'API");
      // 402: progetto in pagamento anticipato (AI Studio) con saldo a zero.
      if (/\b402\b|prepayment credits/i.test(msg)) throw new HttpsError("resource-exhausted", "Credito prepagato di Gemini esaurito: ricaricalo in AI Studio (ai.studio/projects → Billing)");
      if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new HttpsError("resource-exhausted", "Limite di Gemini raggiunto: riprova tra poco (o controlla la fatturazione in AI Studio)");
      if (/\b404\b|not found/i.test(msg)) throw new HttpsError("failed-precondition", "Modello di trascrizione non disponibile per questa chiave");
      if (/nessuna risposta/i.test(msg)) throw new HttpsError("deadline-exceeded", "La trascrizione ci mette troppo: riprova");
      throw new HttpsError("internal", `Trascrizione non riuscita (${msg.slice(0, 160)})`);
    }
  },
);

export const prodotto = onCall(
  { timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const off = await import("./src/prodotti/off.js");
    const ean = off.normalizzaEan(req.data?.ean);
    if (!ean) throw new HttpsError("invalid-argument", "Codice a barre non valido");
    try {
      const db = await getDb();
      const ref = db.collection("prodotti").doc(ean);
      const snap = await ref.get();
      const attuale = snap.exists ? snap.data() : null;
      const eta = attuale?.letto?.toMillis ? Date.now() - attuale.letto.toMillis() : Infinity;
      if (attuale && !req.data?.aggiorna && eta < (attuale.trovato ? CACHE_TROVATO_MS : CACHE_ASSENTE_MS)) {
        return { ...attuale, ean, letto: attuale.letto.toMillis(), aggiornatoOff: attuale.aggiornatoOff?.toMillis?.() || null };
      }
      const grezzo = await off.leggiOff(ean);
      const scheda = grezzo ? off.normalizza(grezzo) : { trovato: false, fonte: "off" };
      const { FieldValue } = await import("firebase-admin/firestore");
      await ref.set({ ...scheda, ean, letto: FieldValue.serverTimestamp(), lettoDa: req.auth.uid }, { merge: false });
      return { ...scheda, ean, letto: Date.now(), aggiornatoOff: scheda.aggiornatoOff?.getTime?.() || null };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("prodotto", ean, err.status || "", String(err.message).slice(0, 200));
      if (err instanceof off.OffError) throw new HttpsError(err.status === 429 ? "resource-exhausted" : "unavailable", err.message);
      throw new HttpsError("internal", `Scheda non letta (${String(err.message).slice(0, 160)})`);
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
    const esiti = await syncAllConnections(db, {
      appId: ENABLE_BANKING_APP_ID.value(),
      privateKey: ENABLE_BANKING_PRIVATE_KEY.value(),
    });
    // Notifiche: spese nuove da confermare, o consenso chiuso dalla banca.
    const { avvisaBanca } = await import("./src/avvisi.js");
    await avvisaBanca(db, esiti);
  },
);
