// Cloud Functions (2ª generazione), regione europe-west1.
// Segreti (Secret Manager): firebase functions:secrets:set ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY
// GOOGLE_OAUTH_CLIENT ({"id","secret"} del client web dell'accesso con Google) lo scrive il deploy.
//
// Funzioni: analyzeEntry (agente del diario), bank (collegamento e lettura della banca), google (account Google:
// Contatti, Calendario, Drive),
// avvisa (notifiche push sulle cose condivise), trascrivi (nota vocale → testo, con Gemini), prodotto (scheda di un
// prodotto da Open Food Facts), syncBank (lettura quotidiana), giroAvvisi (ogni 5 minuti: calendario, promemoria,
// riepilogo del mattino), backupSettimanale (export di Firestore nel bucket del progetto, il lunedì).
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

/** Oltre questo tempo un'analisi «in corso» sulla nota è morta (tempo massimo della funzione 300 s, più il margine). */
const ANALISI_MAX_MS = 330e3;

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
    // A fine analisi: la nota segnata come letta dal server e, se l'app nel frattempo è andata in secondo piano,
    // una notifica a chi l'ha scritta (src/avvisi.js → fineAnalisi). Un errore qui non cambia la risposta.
    let segnata = false; // la nota porta «in corso»: alla fine va chiusa comunque
    const fine = async (esito) => {
      try {
        const { fineAnalisi } = await import("./src/avvisi.js");
        if (await fineAnalisi(await getDb(), req.auth.uid, entryId, esito)) passo("avvisata a fine analisi");
      } catch (e) { console.warn("analyzeEntry: fine analisi", e.code || String(e.message).slice(0, 120)); }
    };
    try {
      passo("inizio");
      const db = await getDb();
      const snap = await db.collection("journal_entries").doc(entryId).get();
      // La propria nota, o una nota condivisa della propria casa (note dei progetti condivisi, 7/11: le modificano e
      // le rianalizzano tutti e due).
      const n = snap.exists ? snap.data() : null;
      const dellaCasa = n?.visibility === "shared" && n.householdId
        && (await db.collection("households").doc(n.householdId).get()).data()?.members?.includes(req.auth.uid);
      if (!n || (n.ownerUid !== req.auth.uid && !dellaCasa)) {
        throw new HttpsError("permission-denied", "Nota non trovata");
      }
      // Stato dell'analisi sulla nota (7/11, Mattia: bloccando il telefono la risposta si perdeva, l'app diceva «non
      // analizzata» e rilanciandola ne partiva una seconda): «in corso» lo scrive il server, così tutti i telefoni lo
      // vedono finché non è davvero finita; una richiesta mentre un'altra è in corso non ne fa partire una seconda.
      // Dopo ANALISI_MAX_MS (oltre il tempo massimo della funzione) un «in corso» rimasto è un'analisi morta.
      const { FieldValue } = await import("firebase-admin/firestore");
      const ref = db.collection("journal_entries").doc(entryId);
      const gia = await db.runTransaction(async (t) => {
        const a = (await t.get(ref)).data()?.analisi;
        const inizio = a?.inizio?.toMillis?.() || 0;
        if (a?.stato === "in_corso" && Date.now() - inizio < ANALISI_MAX_MS) return true;
        t.update(ref, { analisi: { stato: "in_corso", inizio: FieldValue.serverTimestamp(), da: req.auth.uid } });
        return false;
      });
      if (gia) { passo("già in corso"); return { giaInCorso: true }; }
      segnata = true;
      const entry = { id: snap.id, ...snap.data() };
      passo("nota letta");
      const { analyzeJournalEntry } = await import("./src/agent.js");
      const { azioni, riepilogo, titolo, persone, sintesi, sintesiEsito, modello } = await analyzeJournalEntry(db, entry, {
        uid: req.auth.uid,
        passo,
        keys: { anthropic: ANTHROPIC_API_KEY.value().trim(), gemini: GEMINI_API_KEY.value().trim() },
        clientGoogle: clientGoogle(), // per leggere i documenti di Drive del progetto e i contatti nominati
      });
      await fine({ azioni, riepilogo, sintesiEsito, modello });
      return { proposals: azioni, riepilogo, titolo, persone, sintesi, sintesiEsito, modello };
    } catch (err) {
      if (err instanceof HttpsError) {
        if (segnata) await fine({ errore: err.message });
        throw err;
      }
      console.error("analyzeEntry", err);
      // 401: chiave assente o fittizia. Il telefono mostra «AI non ancora collegata».
      if (/\b401\b|authentication|invalid x-api-key/i.test(err.message)) {
        await fine({ errore: "Chiave dell'AI non configurata" });
        throw new HttpsError("failed-precondition", "Chiave dell'AI non configurata");
      }
      // Gli altri errori arrivano al telefono in chiaro: i log delle funzioni non li legge nessuno.
      const [codice, testo] = spiegaErrore(err.message);
      await fine({ errore: testo });
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
/**
 * Contributo a Open Food Facts / Open Beauty Facts (1/11): dalla scheda di un prodotto mancante o incompleto.
 * { azione: "leggi", ean, foto } → Claude legge le foto → { letti, mancanti, tipo, esiste, account: { utente } | null }.
 * { azione: "invia", ean, foto, campi, tipo, account? } → scrive su OFF/OBF solo i campi mancanti e carica le foto,
 * con l'account OFF dell'utente (dato la prima volta dall'app, tenuto in off_account/{uid}, che legge solo il server;
 * si salva dopo una scrittura riuscita), poi rilegge la scheda e aggiorna la cache → { scheda, avvisi }.
 * Vedi src/prodotti/contributo.js.
 */
export const contribuisci = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB" },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const off = await import("./src/prodotti/off.js");
    const c = await import("./src/prodotti/contributo.js");
    const ean = off.normalizzaEan(req.data?.ean);
    if (!ean) throw new HttpsError("invalid-argument", "Codice a barre non valido");
    const foto = c.fotoValide(req.data?.foto);
    const uid = req.auth.uid;
    const db = await getDb();
    const refAccount = db.collection("off_account").doc(uid);
    // Lettura fresca anche qui: i campi mancanti si calcolano sulla scheda vera, non su una copia in cache.
    const leggiProdotto = () => off.leggiOff(ean, { fresco: true }).catch((err) => {
      if (err instanceof off.OffError) throw new HttpsError("unavailable", err.message);
      throw err;
    });
    try {
      if (req.data?.azione === "leggi") {
        if (!foto.length) throw new HttpsError("invalid-argument", "Nessuna foto da leggere");
        const { reason } = await import("./src/ai/claude.js");
        const [conto, grezzo, letti] = await Promise.all([
          refAccount.get(),
          leggiProdotto(),
          c.leggiEtichette({ foto, key: ANTHROPIC_API_KEY.value(), chiedi: reason }),
        ]);
        const tipo = grezzo?.product_type === "beauty" || (!grezzo && letti.tipo === "beauty") ? "beauty" : "food";
        console.log("contribuisci leggi", ean, tipo, grezzo ? "esiste" : "nuovo", foto.map((f) => f.campo).join(","));
        return { letti, tipo, esiste: !!grezzo, mancanti: c.mancanti(grezzo, tipo), account: conto.exists ? { utente: conto.data().utente } : null };
      }
      if (req.data?.azione === "invia") {
        const dato = req.data?.account;
        const nuovoAccount = dato && String(dato.utente || "").trim() && String(dato.password || "") ? { utente: String(dato.utente).trim(), password: String(dato.password) } : null;
        const conto = nuovoAccount ? null : await refAccount.get();
        const account = nuovoAccount || (conto?.exists ? { utente: conto.data().utente, password: conto.data().password } : null);
        if (!account) throw new HttpsError("failed-precondition", "Serve l'account di Open Food Facts");
        const grezzo = await leggiProdotto();
        const tipo = grezzo?.product_type === "beauty" || (!grezzo && req.data?.tipo === "beauty") ? "beauty" : "food";
        const campi = c.campiOff(req.data?.campi || {}, c.mancanti(grezzo, tipo), tipo, !grezzo);
        const { avvisi } = await c.inviaAOff({ ean, tipo, foto, campi, account, uuid: c.appUuid(uid) });
        const { FieldValue } = await import("firebase-admin/firestore");
        if (nuovoAccount) await refAccount.set({ ...nuovoAccount, aggiornato: FieldValue.serverTimestamp() });
        // Rilettura fresca finché OFF non dà una scheda modificata dopo l'invio (`last_modified_t` più recente), al più
        // quattro volte in una decina di secondi. Se resta quella di prima, in cache va con `rileggere`: la prossima
        // apertura la rilegge da OFF invece di tenerla un mese (il 1/11 la scheda vecchia era finita in cache).
        const prima = grezzo?.last_modified_t || 0;
        let nuovo = null;
        for (const pausa of [0, 1500, 3000, 5000]) {
          if (pausa) await new Promise((ok) => setTimeout(ok, pausa));
          nuovo = await off.leggiOff(ean, { fresco: true }).catch(() => null);
          if (nuovo && (nuovo.last_modified_t || 0) > prima) break;
        }
        const aggiornata = !!nuovo && (nuovo.last_modified_t || 0) > prima;
        const scheda = nuovo ? off.normalizza(nuovo) : { trovato: false, fonte: tipo === "beauty" ? "obf" : "off" };
        await db.collection("prodotti").doc(ean).set({ ...scheda, ean, letto: FieldValue.serverTimestamp(), lettoDa: uid,
          ...(aggiornata ? {} : { rileggere: { prima, dal: Date.now() } }) }, { merge: false });
        console.log("contribuisci invia", ean, tipo, Object.keys(campi).join(","), foto.length, "foto", aggiornata ? "riletta" : "OFF non ancora aggiornato", avvisi.length ? `avvisi: ${avvisi.join("; ")}` : "");
        return { scheda: { ...scheda, ean, letto: Date.now(), aggiornatoOff: scheda.aggiornatoOff?.getTime?.() || null, ...(aggiornata ? {} : { inAggiornamento: true }) },
          campi: Object.keys(campi), avvisi, aggiornata };
      }
      throw new HttpsError("invalid-argument", "Azione sconosciuta");
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = String(err.message || err);
      console.error("contribuisci", ean, err.status || "", msg.slice(0, 300));
      if (err instanceof c.ContributoError && err.status === 401) throw new HttpsError("permission-denied", err.message);
      if (err instanceof off.OffError) throw new HttpsError("unavailable", err.message);
      if (/Claude 4\d\d|Claude: /.test(msg)) throw new HttpsError("internal", `Lettura delle foto non riuscita (${msg.slice(0, 120)})`);
      throw new HttpsError("internal", `Contributo non riuscito (${msg.slice(0, 160)})`);
    }
  },
);

// ───────────── Trascrizione delle note vocali ─────────────

// Formati che il telefono registra (MediaRecorder) e che Gemini accetta. Chrome: webm/opus; Safari: mp4 (= m4a).
const FORMATI_AUDIO = { "audio/webm": "audio/webm", "audio/ogg": "audio/ogg", "audio/mp4": "audio/m4a", "audio/m4a": "audio/m4a", "audio/aac": "audio/aac", "audio/mpeg": "audio/mpeg", "audio/wav": "audio/wav" };
const MAX_AUDIO_BASE64 = 12_000_000; // ~9 MB di audio: a 32 kbit/s più di mezz'ora

/**
 * Nota vocale → testo. data = { audio (base64), mimeType, projectId?, prima?, pezzo? }. Ritorna { testo }.
 * Con projectId il prompt riceve nome, istruzioni e temi del progetto; sempre i nomi della rubrica
 * (src/trascrizione.js). Dal 14/11 l'app manda la registrazione a pezzi, tagliati nelle pause, mentre si parla:
 * `prima` è la fine del testo già trascritto (per continuare la frase), `pezzo` il numero, solo per il registro.
 * Un pezzo senza parole torna vuoto. L'audio non viene salvato da nessuna parte.
 */
// Il contesto (rubrica, progetto) si rilegge al più ogni due minuti per persona e progetto: i pezzi di una nota
// arrivano ogni pochi secondi.
const contestiTrascrizione = new Map();
async function contestoPer(db, uid, projectId) {
  const chiave = `${uid}|${projectId || ""}`;
  const c = contestiTrascrizione.get(chiave);
  if (c && Date.now() - c.at < 120_000) return c.contesto;
  const { contestoTrascrizione } = await import("./src/trascrizione.js");
  const contesto = await contestoTrascrizione(db, uid, projectId || null);
  contestiTrascrizione.set(chiave, { at: Date.now(), contesto });
  if (contestiTrascrizione.size > 50) contestiTrascrizione.delete(contestiTrascrizione.keys().next().value);
  return contesto;
}

export const trascrivi = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const { audio, mimeType, projectId } = req.data || {};
    const prima = typeof req.data?.prima === "string" ? req.data.prima.slice(-600) : "";
    const pezzo = Number.isInteger(req.data?.pezzo) ? req.data.pezzo : null;
    if (typeof audio !== "string" || audio.length < 100) throw new HttpsError("invalid-argument", "Registrazione vuota");
    if (audio.length > MAX_AUDIO_BASE64) throw new HttpsError("invalid-argument", "Registrazione troppo lunga: dividila in due note");
    const tipo = FORMATI_AUDIO[String(mimeType || "").split(";")[0].trim().toLowerCase()];
    if (!tipo) throw new HttpsError("invalid-argument", `Formato audio non previsto (${String(mimeType).slice(0, 40)})`);
    const t0 = Date.now();
    try {
      const db = await getDb();
      const contesto = await contestoPer(db, req.auth.uid, projectId);
      const { transcribe } = await import("./src/ai/provider.js");
      const { MODELLO_TRASCRIZIONE } = await import("./src/ai/gemini.js");
      let testo = "", uso = null;
      try {
        ({ testo, uso } = await transcribe({ audioBase64: audio, mimeType: tipo, keys: { gemini: GEMINI_API_KEY.value().trim() }, contesto, prima }));
      } catch (err) {
        // Un pezzo senza parole (una pausa lunga): niente testo, non un errore.
        if (!/trascrizione vuota/i.test(String(err.message))) throw err;
      }
      if (/^\[silenzio\]$/i.test(testo.trim())) testo = "";
      const { registra } = await import("./src/consumi.js");
      const { usd } = await registra(db, req.auth.uid, "trascrizione", { modello: MODELLO_TRASCRIZIONE, uso });
      // Nel registro solo misure: niente testo (il repository è pubblico e la Diagnosi pubblica il registro).
      console.log(`trascrivi: ${Math.round((audio.length * 0.75) / 1024)} KB ${tipo}${pezzo != null ? `, pezzo ${pezzo}` : ""}, ${testo.length} caratteri in ${Date.now() - t0} ms`
        + (uso ? `, token ${uso.promptTokenCount ?? "?"} in / ${uso.candidatesTokenCount ?? "?"} out / ${uso.thoughtsTokenCount ?? 0} pensiero, ${usd.toFixed(5)} $` : "")
        + (contesto.progetto ? ", con progetto" : "") + (prima ? ", con il testo di prima" : ""));
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
      // Una scansione (non una rilettura dei pallini della Lista) entra nella cronologia della casa; se la scrittura
      // non riesce, la scheda arriva lo stesso.
      const segna = async (scheda) => {
        if (!req.data?.scansione) return;
        try {
          const { registraScansione } = await import("./src/prodotti/scansioni.js");
          await registraScansione(db, req.auth.uid, ean, scheda);
        } catch (err) { console.warn("scansione non registrata", ean, String(err.message).slice(0, 160)); }
      };
      // `rileggere`: scheda salvata dopo un contributo quando OFF dava ancora quella di prima → si rilegge fresca.
      // Il segno vale un giorno: se OFF non cambia mai la scheda (contributo scartato), si torna alla cache normale.
      const rileggere = attuale?.rileggere && Date.now() - (attuale.rileggere.dal || 0) < 24 * 3600 * 1000 ? attuale.rileggere : null;
      const fresco = !!req.data?.aggiorna || !!rileggere;
      const valida = attuale && !fresco && eta < (attuale.trovato ? CACHE_TROVATO_MS : CACHE_ASSENTE_MS);
      // Scheda trovata ma normalizzata da una versione più vecchia (mancano campi, es. i marcatori NOVA): si rilegge
      // da OFF; se OFF non risponde o non la trova più, va bene quella in cache.
      const daRileggere = valida && attuale.trovato && (attuale.versioneScheda || 1) < off.VERSIONE_SCHEDA;
      const dallaCache = async () => {
        // Scheda calcolata con un modello dell'indice più vecchio: si ricalcola dai suoi campi, senza OFF.
        const { ricalcola } = await import("./src/prodotti/indice.js");
        const nuovo = ricalcola(attuale);
        if (nuovo) await ref.update(nuovo);
        await segna({ ...attuale, ...(nuovo || {}) });
        const { rileggere: _r, ...resto } = attuale;
        return { ...resto, ...(nuovo || {}), ean, letto: attuale.letto.toMillis(), aggiornatoOff: attuale.aggiornatoOff?.toMillis?.() || null,
          ...(rileggere ? { inAggiornamento: true } : {}) };
      };
      if (valida && !daRileggere) return await dallaCache();
      let grezzo;
      try {
        grezzo = await off.leggiOff(ean, { fresco });
      } catch (err) {
        if ((daRileggere || rileggere) && err instanceof off.OffError) return await dallaCache();
        throw err;
      }
      if (!grezzo && (daRileggere || rileggere)) return await dallaCache();
      const scheda = grezzo ? off.normalizza(grezzo) : { trovato: false, fonte: "off" };
      // Ancora la scheda di prima del contributo: si tiene il segno, la prossima apertura riprova.
      const ancoraVecchia = !!rileggere && (grezzo?.last_modified_t || 0) <= (rileggere.prima || 0);
      const { FieldValue } = await import("firebase-admin/firestore");
      await ref.set({ ...scheda, ean, letto: FieldValue.serverTimestamp(), lettoDa: req.auth.uid, ...(ancoraVecchia ? { rileggere } : {}) }, { merge: false });
      await segna(scheda);
      return { ...scheda, ean, letto: Date.now(), aggiornatoOff: scheda.aggiornatoOff?.getTime?.() || null, ...(ancoraVecchia ? { inAggiornamento: true } : {}) };
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
    // Notifiche: spese nuove da confermare, o consenso chiuso dalla banca (a chi non riceve il riepilogo delle 7:30).
    const { avvisaBanca } = await import("./src/avvisi.js");
    await avvisaBanca(db, esiti);
  },
);

/**
 * Avvisi a orario, ogni 5 minuti: eventi nuovi nel calendario della casa, promemoria degli eventi, riepilogo
 * del mattino alle 7:30. Legge Google Calendar con il permesso di ciascuno (GOOGLE_OAUTH_CLIENT per rinnovarlo).
 * Vedi src/avvisi-calendario.js.
 */
export const giroAvvisi = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Europe/Rome", secrets: [GOOGLE_OAUTH_CLIENT], timeoutSeconds: 120, memory: "256MiB", retryCount: 0 },
  async () => {
    const db = await getDb();
    const { giroAvvisi: giro } = await import("./src/avvisi-calendario.js");
    await giro(db, clientGoogle());
  },
);

// ───────────── Chiedi e revisione della settimana (14/11) ─────────────

/**
 * Chiedi: una domanda sui propri dati ({ id } di domande/{id}, creato dall'app con la domanda). Claude cerca con
 * strumenti di sola lettura (note, spese, task, calendario, progetti, manuale, lista) e risponde con le fonti; stato,
 * passi e risposta li scrive il server sul documento, così arrivano anche se il telefono si blocca. Ritorna { fatta }
 * o { giaInCorso }. Vedi src/chiedi.js.
 */
export const chiedi = onCall(
  { secrets: [ANTHROPIC_API_KEY, GOOGLE_OAUTH_CLIENT], timeoutSeconds: 300 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Accesso richiesto");
    const id = req.data?.id;
    if (typeof id !== "string" || !id || id.includes("/")) throw new HttpsError("invalid-argument", "Domanda mancante");
    const t0 = Date.now();
    try {
      const db = await getDb();
      const { chiedi: rispondi } = await import("./src/chiedi.js");
      // Nel registro solo misure e nomi degli strumenti: niente domande né risposte (repository pubblico).
      return await rispondi(db, req.auth.uid, id, {
        key: ANTHROPIC_API_KEY.value().trim(), clientGoogle: clientGoogle(),
        passo: (p) => console.log(`chiedi ${id}: ${/^(Cerco nelle note|Leggo la sintesi)/.test(p) ? p.split(/[:«(]/)[0].trim() : p} dopo ${Date.now() - t0} ms`),
      });
    } catch (err) {
      if (err.codice === "not-found") throw new HttpsError("not-found", "Domanda non trovata");
      console.error("chiedi", String(err.message).slice(0, 300));
      if (/\b401\b|authentication|invalid x-api-key/i.test(err.message)) throw new HttpsError("failed-precondition", "Chiave dell'AI non configurata");
      const [codice, testo] = spiegaErrore(err.message);
      throw new HttpsError(codice, testo.replace("Analisi non riuscita", "Risposta non riuscita"));
    }
  },
);

/**
 * Revisione della settimana, la domenica alle 18:47: per chi ha un telefono con le notifiche e non ha spento la
 * categoria «settimana», Claude scrive com'è andata (note e progetti, task, spese, i prossimi sette giorni) in una
 * domanda di tipo «settimana», che si apre dalla notifica nella pagina Chiedi. Vedi src/settimana.js.
 */
export const revisioneSettimana = onSchedule(
  { schedule: "47 18 * * 0", timeZone: "Europe/Rome", secrets: [ANTHROPIC_API_KEY, GOOGLE_OAUTH_CLIENT], timeoutSeconds: 540, retryCount: 0 },
  async () => {
    const db = await getDb();
    const { revisioni } = await import("./src/settimana.js");
    await revisioni(db, { key: ANTHROPIC_API_KEY.value().trim(), clientGoogle: clientGoogle() });
  },
);

// ───────────── Backup (14/11) ─────────────

/**
 * Backup settimanale di Firestore, il lunedì alle 3:17: export gestito di tutte le collezioni nel bucket
 * `<progetto>-backup` (stesso progetto; bucket, permessi e conservazione di 8 settimane li prepara il deploy).
 * Aspetta la fine dell'export e scrive nel registro «backup riuscito» o l'errore. Vedi src/backup.js e
 * docs/ARCHITETTURA.md (Backup) per il ripristino.
 */
export const backupSettimanale = onSchedule(
  { schedule: "17 3 * * 1", timeZone: "Europe/Rome", timeoutSeconds: 540, memory: "256MiB", retryCount: 0 },
  async () => {
    const db = await getDb();
    const { applicationDefault } = await import("firebase-admin/app");
    const { backup } = await import("./src/backup.js");
    const credenziale = applicationDefault();
    await backup(db, {
      progetto: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "macroapp-b9bd0",
      token: async () => (await credenziale.getAccessToken()).access_token,
    });
  },
);
